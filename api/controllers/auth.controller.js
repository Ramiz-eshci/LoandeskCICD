'use strict';

/**
 * Authentication reference implementation (A07 Auth Failures).
 *  - Access token: short-lived JWT in the Authorization header.
 *  - Refresh token: long-lived, delivered in an httpOnly + Secure + SameSite
 *    cookie, single-use (rotated on every refresh), hash stored server-side.
 *  - CSRF: double-submit token (readable cookie + X-CSRF-TOKEN header) checked
 *    on the cookie-authenticated /refresh route.
 *  - Passwords: bcrypt.
 *
 * Expected users table columns (see db/schema.sql):
 *   user_id, email, password_hash, role_id, company_id,
 *   is_super_admin (bit), is_company_admin (bit), flag_deleted (bit)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const db = require('../config/database');
const T = require('./common/table.controller');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const audit = require('../services/audit.service');
const { check } = require('../utils/validate');
const mail = require('../services/mail.service');
const { otpEmail, resetPasswordEmail } = require('../services/emailTemplate.service');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Generate an N-digit numeric OTP (crypto-strong). */
function genOtp(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += String(crypto.randomInt(0, 10));
  return out;
}

/** Mask an email address: ta****@gmail.com */
function maskEmail(email) {
  const str = String(email || '');
  const at = str.indexOf('@');
  if (at < 1) return str;
  const name = str.slice(0, at);
  const dom = str.slice(at + 1);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${'*'.repeat(Math.max(2, name.length - head.length))}@${dom}`;
}

/** Mask a phone keeping the last 3 digits: +44 •••• ••• 123 */
function maskPhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  const last3 = digits.slice(-3);
  const cc = raw.startsWith('+') ? '+' + digits.slice(0, 2) : '';
  return `${cc} •••• ••• ${last3}`.trim();
}

/** Enabled OTP delivery channels from .env (meaningful only when default OTP off). */
function otpChannels() {
  const ch = [];
  if (config.otp.sentMobile) ch.push('mobile');
  if (config.otp.sentEmail) ch.push('email');
  return ch;
}

/** Deliver the code on each enabled channel. Mobile SMS is skipped (log only). */
async function deliverOtp(user, code, channels) {
  if (channels.includes('mobile')) {
    // SMS gateway not wired yet — skip real send, log server-side only.
    Logs.info(`[otp] (mobile skip) user ${user.user_id} -> ${maskPhone(user.phone)} code ready`);
  }
  if (channels.includes('email') && user.email) {
    try {
      const { subject, html } = otpEmail({ code, email: user.email, ttlSeconds: config.otp.ttlSeconds });
      const sent = await mail.sendMail({ to: user.email, subject, html, event: 'AUTH_OTP' });
      if (!sent.ok) Logs.info(`[otp] email send failed user ${user.user_id}: ${sent.error}`);
      else Logs.info(`[otp] email sent user ${user.user_id} -> ${maskEmail(user.email)}`);
    } catch (e) {
      Logs.info(`[otp] email error user ${user.user_id}: ${e.message}`);
    }
  }
}

function signAccessToken(user, activeRoleId) {
  return jwt.sign(
    {
      userId: user.user_id,
      email: user.email,
      roleId: activeRoleId != null ? activeRoleId : user.role_id,
      companyId: user.company_id ?? null,
      isSuperAdmin: user.is_super_admin === true || user.is_super_admin === 1,
      isCompanyAdmin: user.is_company_admin === true || user.is_company_admin === 1,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTtl }
  );
}

function signRefreshToken(user, jti) {
  return jwt.sign({ userId: user.user_id, jti }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  });
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: config.jwt.refreshCookiePath,
  };
}

function setAuthCookies(res, refreshToken, csrfToken) {
  res.cookie(config.jwt.refreshCookieName, refreshToken, refreshCookieOptions());
  // CSRF cookie is readable by JS on purpose (double-submit pattern)
  res.cookie(config.jwt.csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
  });
}

async function issueSession(res, user, activeRoleId) {
  const jti = crypto.randomUUID();
  const csrf = crypto.randomBytes(24).toString('hex');
  const refreshToken = signRefreshToken(user, jti);

  // persist a single-use refresh record (store hashes only).
  // active_role_id travels with the record so /auth/refresh can restore the
  // LAST SELECTED role instead of always resetting to the primary role.
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.queryNamed(
    `INSERT INTO ${T.TBL_REFRESH_TOKENS} (jti, user_id, token_hash, csrf_hash, active_role_id, expires_at, revoked, created_at)
     VALUES (@jti, @userId, @tokenHash, @csrfHash, @activeRoleId, @expires, 0, SYSUTCDATETIME())`,
    { jti, userId: user.user_id, tokenHash: sha256(refreshToken), csrfHash: sha256(csrf), activeRoleId: activeRoleId ?? null, expires }
  );

  setAuthCookies(res, refreshToken, csrf);
  return { accessToken: signAccessToken(user, activeRoleId), jti };
}

/**
 * Roles assigned to a user (multi-role), each enriched with the user's branch
 * (per-user via users.branch_id) and this role's last-accessed stamp. Drives
 * the "Select Your Workspace" cards. Falls back to users.role_id.
 */
async function getUserRoles(userId, fallbackRoleId) {
  const rows = await db.query(
    `SELECT r.role_id, r.role_name, ur.is_primary, ur.last_accessed_at,
            b.branch_name
       FROM ${T.TBL_USER_ROLES} ur
       JOIN ${T.TBL_ROLES} r ON r.role_id = ur.role_id
       JOIN ${T.TBL_USERS} u ON u.user_id = ur.user_id
       LEFT JOIN ${T.TBL_BRANCHES} b ON b.branch_id = u.branch_id
      WHERE ur.user_id = @p0 AND r.flag_deleted = 0 AND r.is_active = 1
      ORDER BY ur.is_primary DESC, r.role_id`,
    [userId]
  );
  if (rows.length) return rows;
  if (fallbackRoleId != null) {
    const fb = await db.query(
      `SELECT r.role_id, r.role_name, CAST(1 AS BIT) AS is_primary,
              CAST(NULL AS DATETIME2) AS last_accessed_at, b.branch_name
         FROM ${T.TBL_ROLES} r
         LEFT JOIN ${T.TBL_USERS} u ON u.user_id = @p1
         LEFT JOIN ${T.TBL_BRANCHES} b ON b.branch_id = u.branch_id
        WHERE r.role_id = @p0 AND r.flag_deleted = 0 AND r.is_active = 1`,
      [fallbackRoleId, userId]
    );
    return fb;
  }
  return [];
}

/** Shape a role row into the RoleOption DTO the frontend workspace screen reads. */
function roleToDto(r) {
  return {
    roleId: r.role_id,
    roleName: r.role_name,
    isPrimary: r.is_primary === true || r.is_primary === 1,
    branchName: r.branch_name || null,
    lastAccessedAt: r.last_accessed_at || null,
  };
}

/** Stamp NOW as the last-accessed time for one user/role workspace. Best-effort. */
async function touchRoleAccess(userId, roleId) {
  if (roleId == null) return;
  try {
    await db.query(
      `UPDATE ${T.TBL_USER_ROLES} SET last_accessed_at = SYSUTCDATETIME()
        WHERE user_id = @p0 AND role_id = @p1`,
      [userId, roleId]
    );
  } catch (_e) { /* non-fatal: workspace card timestamp is cosmetic */ }
}

/** Permission list for the active role. Super admin => every permission. */
async function getRolePermissions(roleId, isSuperAdmin) {
  if (isSuperAdmin) {
    const all = await db.query(`SELECT module_key, permission_key FROM ${T.TBL_PERMISSIONS}`);
    return all.map((p) => `${p.module_key}.${p.permission_key}`);
  }
  if (roleId == null) return [];
  const rows = await db.query(
    `SELECT p.module_key, p.permission_key
       FROM ${T.TBL_ROLE_PERMISSIONS} rp
       JOIN ${T.TBL_PERMISSIONS} p ON p.permission_id = rp.permission_id
       JOIN ${T.TBL_ROLES} r ON r.role_id = rp.role_id
      WHERE rp.role_id = @p0 AND r.flag_deleted = 0 AND r.is_active = 1`,
    [roleId]
  );
  return rows.map((p) => `${p.module_key}.${p.permission_key}`);
}

/**
 * Pick the active role: primary first, else lowest role_id.
 * `roles` only ever holds LIVE roles (not deleted, active), so when it is empty
 * there is NO usable role — return null instead of falling back to
 * users.role_id, which may point at a deleted / inactive role.
 */
function pickActiveRole(roles, _fallbackRoleId) {
  if (roles && roles.length) {
    const primary = roles.find((r) => r.is_primary === true || r.is_primary === 1);
    return (primary || roles[0]).role_id;
  }
  return null;
}

/** Admin accounts (server-set flags) bypass RBAC, so they don't need a role. */
function isAdminUser(u) {
  return u.is_super_admin === true || u.is_super_admin === 1
    || u.is_company_admin === true || u.is_company_admin === 1;
}

const INACTIVE_MSG = 'Your account is deactivated. Please contact your administrator.';
const NO_ROLE_MSG = 'No active role is assigned to your account. Please contact your administrator.';
// Pen-test 24-10-2026: the same answer whether or not the e-mail is registered / active,
// so forgot-password can't be used to discover accounts (user enumeration).
const RESET_OK_MSG = 'If an account exists for this email, a password reset link has been sent to it.';
const RESET_BAD_MSG = 'This password reset link is invalid or has expired. Please request a new one.';

/** Build the frontend reset link: <FRONT_URL>/reset-password?token=... */
function resetLink(token) {
  const base = String(config.frontUrl || '').replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/** Password rule for reset (same minimum as User Master create). */
// Password policy shared with the user module (client 26-10-2026).
const { passwordProblem } = require('../utils/validators');

/**
 * Look up a still-usable reset record by raw token (not consumed, not expired,
 * user active + not deleted). Expiry is compared in SQL (UTC) to avoid clock /
 * timezone drift between Node and SQL Server.
 */
async function findUsableReset(token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const rows = await db.query(
    `SELECT pr.reset_id, pr.user_id, u.email
       FROM ${T.TBL_PASSWORD_RESETS} pr
       JOIN ${T.TBL_USERS} u ON u.user_id = pr.user_id
      WHERE pr.token_hash = @p0 AND pr.consumed = 0 AND pr.expires_at > SYSUTCDATETIME()
        AND u.flag_deleted = 0 AND u.is_active = 1`,
    [sha256(token)]
  );
  return rows[0] || null;
}

const SUPER_ADMIN_ROLE_ID = 1; // System Administrator (stable id, cannot be deleted)

/** Dynamic super-admin source: holding the System Administrator role grants it. */
function rolesIncludeSuper(roles) {
  return Array.isArray(roles) && roles.some((r) => Number(r.role_id) === SUPER_ADMIN_ROLE_ID);
}
async function ownsSuperRole(userId) {
  const r = await db.query(
    `SELECT 1 FROM ${T.TBL_USER_ROLES} WHERE user_id = @p0 AND role_id = @p1`,
    [userId, SUPER_ADMIN_ROLE_ID]
  );
  return r.length > 0;
}

module.exports = {
  //#region login (step 1: verify credentials -> issue OTP challenge, NO session yet)
  async login(req, res) {
    try {
      const v = check(req.body, { email: 'required|email', password: 'required' });
      if (!v.ok) {
        return R.badRequest(res, 'Validation Error', v.errors);
      }
      const email = String(req.body.email).toLowerCase().trim();
      const rows = await db.query(
        `SELECT user_id, email, phone, password_hash, flag_deleted, is_active,
                role_id, is_super_admin, is_company_admin
           FROM ${T.TBL_USERS} WHERE email = @p0 AND flag_deleted = 0`,
        [email]
      );
      // uniform message: do not reveal whether the email exists
      // (soft-deleted users are filtered out above => same generic message)
      if (!rows.length) return R.badRequest(res, 'Invalid email or password');
      const user = rows[0];
      const okPass = await bcrypt.compare(String(req.body.password), user.password_hash || '');
      if (!okPass) return R.badRequest(res, 'Invalid email or password');
      // Deactivated account: only revealed AFTER a correct password.
      if (!(user.is_active === true || user.is_active === 1)) {
        await audit.write({
          userId: user.user_id, action: 'LOGIN_BLOCKED_INACTIVE', moduleKey: 'AUTH',
          entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
        });
        return R.forbidden(res, INACTIVE_MSG);
      }
      // Every role deleted / inactive => no workspace to enter, block before OTP.
      if (!isAdminUser(user)) {
        const liveRoles = await getUserRoles(user.user_id, user.role_id);
        if (!rolesIncludeSuper(liveRoles) && !liveRoles.length) {
          await audit.write({
            userId: user.user_id, action: 'LOGIN_BLOCKED_NO_ROLE', moduleKey: 'AUTH',
            entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
          });
          return R.forbidden(res, NO_ROLE_MSG);
        }
      }

      // When default OTP is ON, a FIXED code is used and nothing is sent.
      // When OFF, a random code is generated and delivered on the .env channels
      // (mobile = SMS-skip/log-only, email = branded email).
      const useDefault = config.otp.defaultEnabled;
      const code = useDefault ? String(config.otp.defaultCode) : genOtp(config.otp.length);
      const channels = useDefault ? [] : otpChannels();
      const challengeId = crypto.randomUUID();
      const expires = new Date(Date.now() + config.otp.ttlSeconds * 1000);
      await db.queryNamed(
        `INSERT INTO ${T.TBL_OTP_CHALLENGES} (challenge_id, user_id, otp_hash, expires_at, attempts, consumed, created_at)
         VALUES (@cid, @uid, @hash, @exp, 0, 0, SYSUTCDATETIME())`,
        { cid: challengeId, uid: user.user_id, hash: sha256(code), exp: expires }
      );

      if (!useDefault) await deliverOtp(user, code, channels);
      else Logs.info(`[otp] challenge ${challengeId} user ${user.user_id} (default code, no send)`);

      await audit.write({
        userId: user.user_id, action: 'OTP_SENT', moduleKey: 'AUTH',
        entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
      });

      const body = {
        challengeId,
        otpRequired: true,
        defaultOtp: useDefault,
        otpLength: config.otp.length,
        expiresInSeconds: config.otp.ttlSeconds,
        channels,
        maskedEmail: channels.includes('email') ? maskEmail(user.email) : null,
        maskedMobile: channels.includes('mobile') ? maskPhone(user.phone) : null,
      };
      // Dev convenience only: surface the fixed default code (never in production).
      if (!config.isProd && useDefault) body.devOtp = code;
      return R.ok(res, 'OTP sent', body);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region verify-otp (step 2: verify OTP -> issue session)
  async verifyOtp(req, res) {
    try {
      const v = check(req.body, { challengeId: 'required', otp: 'required' });
      if (!v.ok) return R.badRequest(res, 'Validation Error', v.errors);

      const otp = String(req.body.otp).trim();
      if (!/^[0-9]{6}$/.test(otp)) return R.badRequest(res, 'OTP must be 6 digits');

      const rows = await db.query(
        `SELECT challenge_id, user_id, otp_hash, expires_at, attempts, consumed
           FROM ${T.TBL_OTP_CHALLENGES} WHERE challenge_id = @p0`,
        [req.body.challengeId]
      );
      const ch = rows[0];
      if (!ch || ch.consumed) return R.badRequest(res, 'Invalid or already used code');
      if (new Date(ch.expires_at).getTime() < Date.now()) return R.badRequest(res, 'Code expired, please sign in again');
      if (ch.attempts >= config.otp.maxAttempts) return R.badRequest(res, 'Too many attempts, please sign in again');

      // Dev only: the master/default OTP is accepted in addition to the real sent code.
      // Pen-test 24-10-2026: NEVER in production - there only the code issued for this
      // challenge is valid (with OTP_DEFAULT_ENABLED=true that issued code IS the default).
      const masterCode = !config.isProd && config.otp.defaultCode != null ? String(config.otp.defaultCode) : '';
      const okMaster = masterCode !== '' && otp === masterCode;
      if (ch.otp_hash !== sha256(otp) && !okMaster) {
        await db.query(`UPDATE ${T.TBL_OTP_CHALLENGES} SET attempts = attempts + 1 WHERE challenge_id = @p0`, [req.body.challengeId]);
        return R.badRequest(res, 'Incorrect code');
      }

      // single-use
      await db.query(`UPDATE ${T.TBL_OTP_CHALLENGES} SET consumed = 1 WHERE challenge_id = @p0`, [req.body.challengeId]);

      const urows = await db.query(
        `SELECT user_id, email, full_name, avatar, role_id, company_id, is_super_admin, is_company_admin
           FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0 AND is_active = 1`,
        [ch.user_id]
      );
      if (!urows.length) return R.unauthorized(res, 'User not found');
      const user = urows[0];

      const roles = await getUserRoles(user.user_id, user.role_id);
      // Super-admin is DYNAMIC: holding the System Administrator role grants it,
      // regardless of the users.is_super_admin column or which workspace is active.
      const isSuper = user.is_super_admin === true || user.is_super_admin === 1 || rolesIncludeSuper(roles);
      user.is_super_admin = isSuper ? 1 : 0; // propagate into the signed token
      // Role may have been deleted / deactivated between step 1 and OTP.
      if (!roles.length && !isAdminUser(user)) return R.forbidden(res, NO_ROLE_MSG);
      const activeRoleId = pickActiveRole(roles, user.role_id);
      const { accessToken } = await issueSession(res, user, activeRoleId);
      await touchRoleAccess(user.user_id, activeRoleId);
      const nowIso = new Date();
      for (const r of roles) if (r.role_id === activeRoleId) r.last_accessed_at = nowIso;
      const permissions = await getRolePermissions(activeRoleId, isSuper);

      await audit.write({
        userId: user.user_id, action: 'LOGIN', moduleKey: 'AUTH',
        entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
      });

      return R.ok(res, 'Login successful', {
        accessToken,
        requiresRoleSelection: roles.length > 1,
        activeRoleId,
        roles: roles.map(roleToDto),
        permissions,
        user: {
          userId: user.user_id,
          email: user.email,
          fullName: user.full_name || null,
          avatar: user.avatar || null,
          roleId: activeRoleId,
          isSuperAdmin: isSuper,
          isCompanyAdmin: user.is_company_admin === true || user.is_company_admin === 1,
        },
      });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region resend-otp (regenerate + redeliver the code for a pending challenge)
  async resendOtp(req, res) {
    try {
      const challengeId = req.body && req.body.challengeId;
      if (!challengeId) return R.badRequest(res, 'challengeId is required');

      const rows = await db.query(
        `SELECT challenge_id, user_id, consumed, attempts FROM ${T.TBL_OTP_CHALLENGES} WHERE challenge_id = @p0`,
        [challengeId]
      );
      const ch = rows[0];
      if (!ch || ch.consumed) return R.badRequest(res, 'Invalid or already used code, please sign in again');
      if (ch.attempts >= config.otp.maxAttempts) return R.badRequest(res, 'Too many attempts, please sign in again');

      const urows = await db.query(
        `SELECT user_id, email, phone FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0 AND is_active = 1`,
        [ch.user_id]
      );
      if (!urows.length) return R.badRequest(res, 'User not found');
      const user = urows[0];

      const useDefault = config.otp.defaultEnabled;
      const code = useDefault ? String(config.otp.defaultCode) : genOtp(config.otp.length);
      const channels = useDefault ? [] : otpChannels();
      const expires = new Date(Date.now() + config.otp.ttlSeconds * 1000);

      // regenerate on the SAME challenge: new hash + expiry. Pen-test 24-10-2026: the wrong-
      // attempt counter is NOT reset, so resending can't be used to get unlimited guesses
      // (OTP_MAX_ATTEMPTS per challenge in total; then the user signs in again).
      await db.queryNamed(
        `UPDATE ${T.TBL_OTP_CHALLENGES}
            SET otp_hash = @hash, expires_at = @exp, consumed = 0
          WHERE challenge_id = @cid`,
        { hash: sha256(code), exp: expires, cid: challengeId }
      );

      if (!useDefault) await deliverOtp(user, code, channels);
      else Logs.info(`[otp] resend challenge ${challengeId} user ${user.user_id} (default code, no send)`);

      await audit.write({
        userId: user.user_id, action: 'OTP_RESENT', moduleKey: 'AUTH',
        entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
      });

      const body = {
        challengeId,
        otpLength: config.otp.length,
        expiresInSeconds: config.otp.ttlSeconds,
        channels,
        maskedEmail: channels.includes('email') ? maskEmail(user.email) : null,
        maskedMobile: channels.includes('mobile') ? maskPhone(user.phone) : null,
      };
      if (!config.isProd && useDefault) body.devOtp = code;
      return R.ok(res, 'OTP resent', body);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region refresh (single-use rotation + CSRF)
  async refresh(req, res) {
    try {
      const token = req.cookies ? req.cookies[config.jwt.refreshCookieName] : null;
      if (!token) return R.unauthorized(res, 'No refresh token');

      // CSRF double-submit check
      const csrfCookie = req.cookies ? req.cookies[config.jwt.csrfCookieName] : null;
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return R.forbidden(res, 'CSRF validation failed');
      }

      let payload;
      try {
        payload = jwt.verify(token, config.jwt.refreshSecret);
      } catch {
        return R.unauthorized(res, 'Invalid refresh token');
      }

      const rows = await db.query(
        `SELECT jti, user_id, token_hash, csrf_hash, active_role_id, revoked, expires_at
           FROM ${T.TBL_REFRESH_TOKENS} WHERE jti = @p0`,
        [payload.jti]
      );
      const record = rows[0];
      if (!record || record.revoked || record.token_hash !== sha256(token)) {
        return R.unauthorized(res, 'Refresh token no longer valid');
      }
      if (record.csrf_hash !== sha256(csrfHeader)) {
        return R.forbidden(res, 'CSRF validation failed');
      }
      if (new Date(record.expires_at).getTime() < Date.now()) {
        return R.unauthorized(res, 'Refresh token expired');
      }

      // single use: revoke the old one
      await db.query(`UPDATE ${T.TBL_REFRESH_TOKENS} SET revoked = 1 WHERE jti = @p0`, [payload.jti]);

      const userRows = await db.query(
        `SELECT user_id, email, role_id, company_id, is_super_admin, is_company_admin
           FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0 AND is_active = 1`,
        [record.user_id]
      );
      if (!userRows.length) return R.unauthorized(res, 'User not found');

      const ru = userRows[0];
      const rRoles = await getUserRoles(ru.user_id, ru.role_id);
      const isSuper = ru.is_super_admin === true || ru.is_super_admin === 1 || rolesIncludeSuper(rRoles);
      ru.is_super_admin = isSuper ? 1 : 0; // propagate into the refreshed token
      // All roles deleted / deactivated since login => end the session.
      if (!rRoles.length && !isAdminUser(ru)) return R.unauthorized(res, NO_ROLE_MSG);
      // Carry forward the LAST SELECTED role (stored on the refresh-token
      // record by /auth/select-role), not always the primary role — but only
      // if the user still actually owns that role (it may have been removed
      // since the token was issued).
      const stillOwnsActive = record.active_role_id != null
        && rRoles.some((r) => r.role_id === record.active_role_id);
      const rActive = stillOwnsActive ? record.active_role_id : pickActiveRole(rRoles, ru.role_id);
      const { accessToken } = await issueSession(res, ru, rActive);
      return R.ok(res, 'Token refreshed', { accessToken, activeRoleId: rActive });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region logout
  async logout(req, res) {
    try {
      const token = req.cookies ? req.cookies[config.jwt.refreshCookieName] : null;
      if (token) {
        try {
          const payload = jwt.verify(token, config.jwt.refreshSecret);
          await db.query(`UPDATE ${T.TBL_REFRESH_TOKENS} SET revoked = 1 WHERE jti = @p0`, [payload.jti]);
        } catch {
          /* ignore */
        }
      }
      res.clearCookie(config.jwt.refreshCookieName, refreshCookieOptions());
      res.clearCookie(config.jwt.csrfCookieName, { path: '/' });
      return R.ok(res, 'Logged out');
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region select-role (switch active workspace/role)
  async selectRole(req, res) {
    try {
      const roleId = Number(req.body && req.body.roleId);
      if (!Number.isInteger(roleId)) return R.badRequest(res, 'roleId is required');
      const u = req.userData;

      const userRows = await db.query(
        `SELECT user_id, email, role_id, company_id, is_super_admin, is_company_admin
           FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0 AND is_active = 1`,
        [u.userId]
      );
      if (!userRows.length) return R.unauthorized(res, 'User not found');
      const user = userRows[0];
      const isSuper = user.is_super_admin === true || user.is_super_admin === 1
        || await ownsSuperRole(user.user_id);
      user.is_super_admin = isSuper ? 1 : 0; // propagate into the re-signed token

      // must actually own the role (super admin may pick any active role)
      const owned = await db.query(
        `SELECT 1 FROM ${T.TBL_USER_ROLES} WHERE user_id = @p0 AND role_id = @p1`,
        [u.userId, roleId]
      );
      if (!owned.length && !isSuper) {
        return R.forbidden(res, 'Role not assigned to this user');
      }
      // role must exist / be active
      const roleRow = await db.query(
        `SELECT role_id FROM ${T.TBL_ROLES} WHERE role_id = @p0 AND flag_deleted = 0 AND is_active = 1`,
        [roleId]
      );
      if (!roleRow.length) return R.badRequest(res, 'Invalid role');

      const accessToken = signAccessToken(user, roleId);
      await touchRoleAccess(user.user_id, roleId);
      const permissions = await getRolePermissions(roleId, isSuper);

      // Persist the choice on the live refresh-token record so a later
      // /auth/refresh (e.g. on page reload) restores THIS role instead of
      // resetting to the primary role. Best-effort: if the refresh cookie
      // isn't present/valid we still return the new access token — the
      // in-tab session works, it just won't survive a reload.
      const rtoken = req.cookies ? req.cookies[config.jwt.refreshCookieName] : null;
      if (rtoken) {
        try {
          const rpayload = jwt.verify(rtoken, config.jwt.refreshSecret);
          await db.query(
            `UPDATE ${T.TBL_REFRESH_TOKENS} SET active_role_id = @p0 WHERE jti = @p1 AND user_id = @p2 AND revoked = 0`,
            [roleId, rpayload.jti, u.userId]
          );
        } catch {
          /* refresh cookie missing/expired — access-token-only session, ignore */
        }
      }

      return R.ok(res, 'Workspace selected', { accessToken, activeRoleId: roleId, permissions });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region forgot-password (email a single-use, time-boxed reset link)
  async forgotPassword(req, res) {
    try {
      const v = check(req.body, { email: 'required|email' });
      if (!v.ok) return R.badRequest(res, 'Validation Error', v.errors);
      const email = String(req.body.email).toLowerCase().trim();

      const rows = await db.query(
        `SELECT user_id, email, full_name, is_active FROM ${T.TBL_USERS}
          WHERE email = @p0 AND flag_deleted = 0`,
        [email]
      );
      // Unknown / soft-deleted / deactivated => no link, but the SAME response as success.
      if (!rows.length) {
        Logs.info(`[pwreset] request for unknown email ${maskEmail(email)}`);
        return R.ok(res, RESET_OK_MSG, {});
      }
      const user = rows[0];
      if (!(user.is_active === true || user.is_active === 1)) {
        Logs.info(`[pwreset] request for deactivated user ${user.user_id} (no link sent)`);
        await audit.write({
          userId: user.user_id, action: 'PASSWORD_RESET_BLOCKED_INACTIVE', moduleKey: 'AUTH',
          entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
        });
        return R.ok(res, RESET_OK_MSG, {});
      }

      // Only the newest link is valid: retire any earlier unused links.
      await db.query(
        `UPDATE ${T.TBL_PASSWORD_RESETS} SET consumed = 1, consumed_at = SYSUTCDATETIME()
          WHERE user_id = @p0 AND consumed = 0`,
        [user.user_id]
      );

      const token = crypto.randomBytes(32).toString('hex');
      const ttl = config.passwordReset.ttlMinutes;
      await db.queryNamed(
        `INSERT INTO ${T.TBL_PASSWORD_RESETS} (user_id, token_hash, expires_at, consumed, request_ip, created_at)
         VALUES (@uid, @hash, DATEADD(MINUTE, @ttl, SYSUTCDATETIME()), 0, @ip, SYSUTCDATETIME())`,
        { uid: user.user_id, hash: sha256(token), ttl, ip: String(req.clientIp || req.ip || '').slice(0, 64) }
      );

      const link = resetLink(token);
      try {
        const { subject, html } = resetPasswordEmail({ link, name: user.full_name, ttlMinutes: ttl });
        const sent = await mail.sendMail({ to: user.email, subject, html, event: 'AUTH_RESET_PASSWORD', req });
        if (!sent.ok) Logs.info(`[pwreset] email send failed user ${user.user_id}: ${sent.error}`);
        else Logs.info(`[pwreset] email sent user ${user.user_id} -> ${maskEmail(user.email)}`);
      } catch (e) {
        Logs.info(`[pwreset] email error user ${user.user_id}: ${e.message}`);
      }

      await audit.write({
        userId: user.user_id, action: 'PASSWORD_RESET_REQUESTED', moduleKey: 'AUTH',
        entityName: 'users', entityId: user.user_id, ip: req.clientIp || req.ip,
      });

      const body = {};
      // Dev convenience only (like devOtp): surface the link when not in production.
      if (!config.isProd) body.devResetLink = link;
      return R.ok(res, RESET_OK_MSG, body);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region reset-password/validate (is the link still usable?)
  async validateResetToken(req, res) {
    try {
      const rec = await findUsableReset(req.body && req.body.token);
      if (!rec) return R.badRequest(res, RESET_BAD_MSG);
      return R.ok(res, 'Reset link is valid', { valid: true, maskedEmail: maskEmail(rec.email) });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region reset-password (set new password; link is consumed exactly once)
  async resetPassword(req, res) {
    try {
      const token = req.body && req.body.token;
      const password = req.body && req.body.password;
      const confirm = req.body && req.body.confirmPassword;
      if (!token) return R.badRequest(res, RESET_BAD_MSG);
      const problem = passwordProblem(password);
      if (problem) return R.badRequest(res, 'Validation Error', { password: [problem] });
      if (confirm != null && String(confirm) !== String(password)) {
        return R.badRequest(res, 'Validation Error', { confirmPassword: ['Passwords do not match.'] });
      }

      const rec = await findUsableReset(token);
      if (!rec) return R.badRequest(res, RESET_BAD_MSG);

      // Atomic single-use claim: only ONE request can flip consumed 0 -> 1.
      const claimed = await db.query(
        `UPDATE ${T.TBL_PASSWORD_RESETS}
            SET consumed = 1, consumed_at = SYSUTCDATETIME()
         OUTPUT INSERTED.user_id
          WHERE reset_id = @p0 AND consumed = 0 AND expires_at > SYSUTCDATETIME()`,
        [rec.reset_id]
      );
      if (!claimed.length) return R.badRequest(res, RESET_BAD_MSG);

      const hash = await bcrypt.hash(String(password), 10);
      await db.query(
        `UPDATE ${T.TBL_USERS} SET password_hash = @p1, updated_at = SYSUTCDATETIME()
          WHERE user_id = @p0 AND flag_deleted = 0`,
        [rec.user_id, hash]
      );
      // Sign out every existing session and retire any other pending links.
      await db.query(`UPDATE ${T.TBL_REFRESH_TOKENS} SET revoked = 1 WHERE user_id = @p0 AND revoked = 0`, [rec.user_id]);
      await db.query(
        `UPDATE ${T.TBL_PASSWORD_RESETS} SET consumed = 1, consumed_at = SYSUTCDATETIME()
          WHERE user_id = @p0 AND consumed = 0`,
        [rec.user_id]
      );

      await audit.write({
        userId: rec.user_id, action: 'PASSWORD_RESET', moduleKey: 'AUTH',
        entityName: 'users', entityId: rec.user_id, ip: req.clientIp || req.ip,
      });
      return R.ok(res, 'Your password has been reset. Please sign in with your new password.', {});
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region me
  async me(req, res) {
    try {
      const u = req.userData;
      const roles = await getUserRoles(u.userId, u.roleId);
      const permissions = await getRolePermissions(u.roleId, u.isSuperAdmin);
      // Display name for the header/account menu (not carried in the JWT).
      const nrows = await db.query(`SELECT full_name, avatar FROM ${T.TBL_USERS} WHERE user_id = @p0`, [u.userId]);
      return R.ok(res, 'Current user', {
        ...u,
        fullName: (nrows[0] && nrows[0].full_name) || null,
        avatar: (nrows[0] && nrows[0].avatar) || null,
        activeRoleId: u.roleId,
        roles: roles.map(roleToDto),
        permissions,
      });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion
};
