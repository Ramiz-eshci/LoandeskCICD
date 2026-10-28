'use strict';

/**
 * Auth flow end-to-end through Express (supertest) against an in-memory fake of
 * the auth tables: login -> OTP challenge -> verify -> refresh rotation -> logout,
 * plus forgot / reset password. Mail and audit are stubbed.
 */

jest.mock('../../config/database', () => {
  const crypto = require('crypto');
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  const state = { users: [], userRoles: [], otp: new Map(), refresh: new Map(), resets: [] };
  const now = () => Date.now();
  async function query(sql, p = []) {
    const s = sql.replace(/\s+/g, ' ');
    if (s.includes('FROM users WHERE email = @p0')) return state.users.filter((u) => u.email === p[0] && !u.flag_deleted);
    if (s.includes('FROM users WHERE user_id = @p0')) {
      return state.users.filter((u) => u.user_id === p[0] && !u.flag_deleted && (!s.includes('is_active = 1') || u.is_active));
    }
    if (s.includes('FROM user_roles ur JOIN roles r')) return state.userRoles.filter((r) => r.user_id === p[0]);
    if (s.includes('FROM roles r LEFT JOIN users u')) return [];
    if (s.includes('UPDATE user_roles SET last_accessed_at')) return [];
    if (s.includes('FROM role_permissions rp JOIN permissions p') || s.includes('FROM permissions')) return [{ module_key: 'ENQUIRIES.ENQUIRY_LIST', permission_key: 'view' }];
    if (s.includes('FROM otp_challenges WHERE challenge_id = @p0')) { const c = state.otp.get(p[0]); return c ? [{ ...c }] : []; }
    if (s.includes('UPDATE otp_challenges SET attempts = attempts + 1')) { state.otp.get(p[0]).attempts += 1; return []; }
    if (s.includes('UPDATE otp_challenges SET consumed = 1')) { state.otp.get(p[0]).consumed = 1; return []; }
    if (s.includes('FROM refresh_tokens WHERE jti = @p0')) { const r = state.refresh.get(p[0]); return r ? [{ ...r }] : []; }
    if (s.includes('UPDATE refresh_tokens SET revoked = 1 WHERE jti = @p0')) { const r = state.refresh.get(p[0]); if (r) r.revoked = 1; return []; }
    if (s.includes('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = @p0')) { for (const r of state.refresh.values()) if (r.user_id === p[0]) r.revoked = 1; return []; }
    if (s.includes('UPDATE password_resets SET consumed = 1, consumed_at = SYSUTCDATETIME() WHERE user_id')) { state.resets.filter((r) => r.user_id === p[0]).forEach((r) => { r.consumed = 1; }); return []; }
    if (s.includes('FROM password_resets pr JOIN users u')) {
      return state.resets.filter((r) => r.token_hash === p[0] && !r.consumed && r.expires > now())
        .map((r) => ({ reset_id: r.reset_id, user_id: r.user_id, email: state.users.find((u) => u.user_id === r.user_id).email }));
    }
    if (s.includes('UPDATE password_resets SET consumed = 1, consumed_at = SYSUTCDATETIME() OUTPUT')) {
      const r = state.resets.find((x) => x.reset_id === p[0] && !x.consumed);
      if (!r) return [];
      r.consumed = 1;
      return [{ user_id: r.user_id }];
    }
    if (s.includes('UPDATE users SET password_hash')) { state.users.find((u) => u.user_id === p[0]).password_hash = p[1]; return []; }
    if (s.includes('SELECT user_id, email, full_name, is_active FROM users')) return state.users.filter((u) => u.email === p[0] && !u.flag_deleted);
    return [];
  }
  async function queryNamed(sql, p = {}) {
    const s = sql.replace(/\s+/g, ' ');
    if (s.includes('INSERT INTO otp_challenges')) state.otp.set(p.cid, { challenge_id: p.cid, user_id: p.uid, otp_hash: p.hash, expires_at: p.exp, attempts: 0, consumed: 0 });
    else if (s.includes('UPDATE otp_challenges SET otp_hash')) {
      // mirror the real SQL: attempts are only reset if the statement says so
      Object.assign(state.otp.get(p.cid), { otp_hash: p.hash, expires_at: p.exp, consumed: 0, ...(s.includes('attempts = 0') ? { attempts: 0 } : {}) });
    }
    else if (s.includes('INSERT INTO refresh_tokens')) state.refresh.set(p.jti, { jti: p.jti, user_id: p.userId, token_hash: p.tokenHash, csrf_hash: p.csrfHash, active_role_id: p.activeRoleId, revoked: 0, expires_at: p.expires });
    else if (s.includes('INSERT INTO password_resets')) state.resets.push({ reset_id: state.resets.length + 1, user_id: p.uid, token_hash: p.hash, consumed: 0, expires: now() + p.ttl * 60000 });
    return [];
  }
  return { query: jest.fn(query), queryNamed: jest.fn(queryNamed), __state: state, __sha: sha };
});
jest.mock('../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn((r, x) => x) }));
jest.mock('../../services/mail.service', () => ({ sendMail: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock('../../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');
const mail = require('../../services/mail.service');
const audit = require('../../services/audit.service');

// Loading the whole Express app can take a few seconds on Windows / cold caches.
jest.setTimeout(30000);

let app;
let config;
const PASSWORD = 'Correct-Horse-9';

beforeAll(async () => {
  app = require('../../app');
  config = require('../../config/env').config;
  const hash = await bcrypt.hash(PASSWORD, 4);
  db.__state.users.push(
    { user_id: 1, email: 'jane@lender.co.uk', phone: '+447700900123', full_name: 'Jane', password_hash: hash, is_active: 1, flag_deleted: 0, role_id: 5, is_super_admin: 0, is_company_admin: 0 },
    { user_id: 2, email: 'old@lender.co.uk', password_hash: hash, is_active: 0, flag_deleted: 0, role_id: 5 },
    { user_id: 3, email: 'norole@lender.co.uk', password_hash: hash, is_active: 1, flag_deleted: 0, role_id: null },
  );
  db.__state.userRoles.push({ user_id: 1, role_id: 5, role_name: 'BDM', is_primary: 1 }, { user_id: 2, role_id: 5, role_name: 'BDM', is_primary: 1 });
}, 60000);

let otpSaved;
beforeEach(() => {
  otpSaved = { ...config.otp };
  // real (random) codes delivered by e-mail, no master code
  Object.assign(config.otp, { defaultEnabled: false, sentEmail: true, sentMobile: false, defaultCode: '' });
  mail.sendMail.mockClear();
  audit.write.mockClear();
});
afterEach(() => Object.assign(config.otp, otpSaved));

const login = (email = 'jane@lender.co.uk', password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });
/** Pull the OTP out of the (stubbed) e-mail. */
const sentCode = () => mail.sendMail.mock.calls.at(-1)[0].html.match(/>(\d)</g).map((m) => m[1]).join('');
const cookie = (res, name) => (name = ({ ld_refresh: config.jwt.refreshCookieName, ld_csrf: config.jwt.csrfCookieName })[name] || name, (res.headers['set-cookie'] || []).find((c) => c.startsWith(name + '=')));
const cookieVal = (c) => c.split(';')[0].split('=').slice(1).join('=');

async function fullLogin() {
  const l = await login();
  const v = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: sentCode() });
  return v;
}

describe('POST /api/auth/login', () => {
  it('validates input', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation Error');
  });

  it('gives the SAME message for an unknown email and a wrong password (no enumeration)', async () => {
    const a = await login('ghost@lender.co.uk');
    const b = await login('jane@lender.co.uk', 'wrong-password');
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(a.body.message).toBe('Invalid email or password');
    expect(b.body.message).toBe(a.body.message);
  });

  it('reveals a deactivated account only after a correct password', async () => {
    expect((await login('old@lender.co.uk', 'wrong')).status).toBe(400);
    const res = await login('old@lender.co.uk');
    expect(res.status).toBe(403);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_BLOCKED_INACTIVE' }));
  });

  it('blocks a user with no live role before any OTP is sent', async () => {
    const res = await login('norole@lender.co.uk');
    expect(res.status).toBe(403);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('creates an OTP challenge, e-mails the code, and issues NO session yet', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ otpRequired: true, defaultOtp: false, otpLength: 6, channels: ['email'], maskedEmail: 'ja**@lender.co.uk' });
    expect(res.body.data.devOtp).toBeUndefined();
    expect(res.body.data.accessToken).toBeUndefined();
    expect(cookie(res, 'ld_refresh')).toBeUndefined();
    expect(sentCode()).toMatch(/^\d{6}$/);
    // only the hash of the code is stored
    const ch = db.__state.otp.get(res.body.data.challengeId);
    expect(ch.otp_hash).toBe(db.__sha(sentCode()));
  });
});

describe('POST /api/auth/verify-otp', () => {
  it('rejects a non 6-digit code', async () => {
    const res = await request(app).post('/api/auth/verify-otp').send({ challengeId: 'x', otp: '12ab' });
    expect(res.body.message).toBe('OTP must be 6 digits');
  });

  it('counts wrong codes and locks the challenge after OTP_MAX_ATTEMPTS', async () => {
    const l = await login();
    const cid = l.body.data.challengeId;
    const wrong = sentCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < config.otp.maxAttempts; i++) {
      expect((await request(app).post('/api/auth/verify-otp').send({ challengeId: cid, otp: wrong })).body.message).toBe('Incorrect code');
    }
    const res = await request(app).post('/api/auth/verify-otp').send({ challengeId: cid, otp: sentCode() });
    expect(res.body.message).toBe('Too many attempts, please sign in again');
  });

  it('rejects an expired challenge', async () => {
    const l = await login();
    db.__state.otp.get(l.body.data.challengeId).expires_at = new Date(Date.now() - 1000);
    const res = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: sentCode() });
    expect(res.body.message).toBe('Code expired, please sign in again');
  });

  it('issues an access token + httpOnly refresh cookie + CSRF cookie, and the code is single-use', async () => {
    const l = await login();
    const code = sentCode();
    const res = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: code });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.data.accessToken, config.jwt.secret);
    expect(payload).toMatchObject({ userId: 1, roleId: 5, isSuperAdmin: false });
    expect(res.body.data.permissions).toEqual(['ENQUIRIES.ENQUIRY_LIST.view']);

    const rc = cookie(res, 'ld_refresh');
    expect(rc).toMatch(/HttpOnly/i);
    expect(rc).toMatch(/SameSite=Lax/i);
    expect(rc).toContain(`Path=${config.jwt.refreshCookiePath}`);
    expect(cookie(res, 'ld_csrf')).not.toMatch(/HttpOnly/i);

    const again = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: code });
    expect(again.body.message).toBe('Invalid or already used code');
  });

  it('resend does NOT reset the wrong-attempt counter (pen-test 24-10-2026)', async () => {
    const l = await login();
    const cid = l.body.data.challengeId;
    for (let i = 0; i < config.otp.maxAttempts - 1; i++) {
      await request(app).post('/api/auth/verify-otp').send({ challengeId: cid, otp: sentCode() === '000000' ? '111111' : '000000' });
    }
    await request(app).post('/api/auth/resend-otp').send({ challengeId: cid });
    const wrong = sentCode() === '000000' ? '111111' : '000000';
    expect((await request(app).post('/api/auth/verify-otp').send({ challengeId: cid, otp: wrong })).body.message).toBe('Incorrect code');
    // limit reached: even the right code and further resends are refused
    expect((await request(app).post('/api/auth/verify-otp').send({ challengeId: cid, otp: sentCode() })).body.message).toBe('Too many attempts, please sign in again');
    expect((await request(app).post('/api/auth/resend-otp').send({ challengeId: cid })).body.message).toBe('Too many attempts, please sign in again');
  });

  it('resend issues a new code on the same challenge', async () => {
    const l = await login();
    const first = sentCode();
    const r = await request(app).post('/api/auth/resend-otp').send({ challengeId: l.body.data.challengeId });
    expect(r.status).toBe(200);
    const second = sentCode();
    expect(db.__state.otp.get(l.body.data.challengeId).otp_hash).toBe(db.__sha(second));
    if (first !== second) {
      expect((await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: first })).body.message).toBe('Incorrect code');
    }
  });

  describe('master / default code (pen-test fix 24-10-2026)', () => {
    let savedProd;
    beforeEach(() => { savedProd = config.isProd; });
    afterEach(() => { config.isProd = savedProd; });
    const notTheSentCode = (code) => (code === '999999' ? '999998' : '999999');

    it('production: the default code is NOT accepted when real codes are in use', async () => {
      config.isProd = true;
      config.otp.defaultCode = '999999';
      const l = await login();
      const master = '999999';
      if (sentCode() === master) config.otp.defaultCode = notTheSentCode(master);
      const res = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: config.otp.defaultCode });
      expect(res.body.message).toBe('Incorrect code');
      expect(res.body.data && res.body.data.accessToken).toBeFalsy();
    });

    it('production: never returns devOtp, even with the fixed code switched on', async () => {
      config.isProd = true;
      Object.assign(config.otp, { defaultEnabled: true, defaultCode: '246810' });
      const l = await login();
      expect(l.body.data.defaultOtp).toBe(true);
      expect(l.body.data.devOtp).toBeUndefined();
      // with the fixed code ON the issued code is that code, so it still verifies
      const v = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: '246810' });
      expect(v.status).toBe(200);
    });

    it('development: the default code is still accepted as a convenience', async () => {
      config.isProd = false;
      config.otp.defaultCode = '999999';
      const l = await login();
      const res = await request(app).post('/api/auth/verify-otp').send({ challengeId: l.body.data.challengeId, otp: '999999' });
      expect(res.status).toBe(200);
    });
  });
});

describe('POST /api/auth/refresh (rotation + CSRF)', () => {
  it('requires the refresh cookie and a matching CSRF header', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    const v = await fullLogin();
    const rc = cookie(v, 'ld_refresh').split(';')[0];
    const csrf = cookieVal(cookie(v, 'ld_csrf'));
    const noHeader = await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=${csrf}`]);
    expect(noHeader.status).toBe(403);
    const mismatch = await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=${csrf}`]).set('X-CSRF-TOKEN', 'other');
    expect(mismatch.status).toBe(403);
    const forged = await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=forged`]).set('X-CSRF-TOKEN', 'forged');
    expect(forged.status).toBe(403); // cookie==header but not the CSRF issued with this token
  });

  it('rotates: a refresh token works once, replaying it is refused', async () => {
    const v = await fullLogin();
    const rc = cookie(v, 'ld_refresh').split(';')[0];
    const csrf = cookieVal(cookie(v, 'ld_csrf'));
    const ok = await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=${csrf}`]).set('X-CSRF-TOKEN', csrf);
    expect(ok.status).toBe(200);
    expect(jwt.verify(ok.body.data.accessToken, config.jwt.secret).userId).toBe(1);
    expect(cookie(ok, 'ld_refresh')).toBeDefined();
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=${csrf}`]).set('X-CSRF-TOKEN', csrf);
    expect(replay.status).toBe(401);
  });

  it('logout revokes the refresh token and clears the cookies', async () => {
    const v = await fullLogin();
    const rc = cookie(v, 'ld_refresh').split(';')[0];
    const csrf = cookieVal(cookie(v, 'ld_csrf'));
    expect((await request(app).get('/api/auth/logout').set('Cookie', [rc])).status).toBe(404); // POST only now
    const out = await request(app).post('/api/auth/logout').set('Cookie', [rc]);
    expect(out.status).toBe(200);
    expect(cookie(out, 'ld_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const after = await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=${csrf}`]).set('X-CSRF-TOKEN', csrf);
    expect(after.status).toBe(401);
  });
});

describe('forgot / reset password', () => {
  it('e-mails a single-use link; reset changes the password and signs out every session', async () => {
    const session = await fullLogin();
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'jane@lender.co.uk' });
    expect(res.status).toBe(200);
    const link = mail.sendMail.mock.calls.at(-1)[0].html.match(/href="([^"]+)"/)[1];
    const token = decodeURIComponent(link.split('token=')[1]);
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    expect((await request(app).post('/api/auth/reset-password/validate').send({ token })).body.data).toMatchObject({ valid: true });
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
    const ok = await request(app).post('/api/auth/reset-password').send({ token, password: 'New-Password-123', confirmPassword: 'New-Password-123' });
    expect(ok.status).toBe(200);

    // single use
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Another-Pass-1' })).status).toBe(400);
    // old password no longer works, new one does
    expect((await login('jane@lender.co.uk', PASSWORD)).status).toBe(400);
    expect((await login('jane@lender.co.uk', 'New-Password-123')).status).toBe(200);
    // existing refresh token was revoked
    const rc = cookie(session, 'ld_refresh').split(';')[0];
    const csrf = cookieVal(cookie(session, 'ld_csrf'));
    expect((await request(app).post('/api/auth/refresh').set('Cookie', [rc, `${config.jwt.csrfCookieName}=${csrf}`]).set('X-CSRF-TOKEN', csrf)).status).toBe(401);
    // restore for other tests
    db.__state.users[0].password_hash = await bcrypt.hash(PASSWORD, 4);
  });

  it('a new link retires the previous one', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'jane@lender.co.uk' });
    const t1 = decodeURIComponent(mail.sendMail.mock.calls.at(-1)[0].html.match(/token=([^"&]+)/)[1]);
    await request(app).post('/api/auth/forgot-password').send({ email: 'jane@lender.co.uk' });
    expect((await request(app).post('/api/auth/reset-password/validate').send({ token: t1 })).status).toBe(400);
  });

  it('rejects malformed tokens without a database lookup', async () => {
    db.query.mockClear();
    expect((await request(app).post('/api/auth/reset-password/validate').send({ token: "' OR 1=1 --" })).status).toBe(400);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('password_resets'))).toBe(false);
  });

  it('does not reveal whether an e-mail is registered or active (pen-test 24-10-2026)', async () => {
    const send = (email) => request(app).post('/api/auth/forgot-password').send({ email });
    mail.sendMail.mockClear();
    const unknown = await send('ghost@lender.co.uk');
    const inactive = await send('old@lender.co.uk');
    expect(mail.sendMail).not.toHaveBeenCalled();
    const known = await send('jane@lender.co.uk');
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    for (const r of [unknown, inactive, known]) {
      expect(r.status).toBe(200);
      expect(r.body.message).toBe('If an account exists for this email, a password reset link has been sent to it.');
    }
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_RESET_BLOCKED_INACTIVE', userId: 2 }));
  });
});
