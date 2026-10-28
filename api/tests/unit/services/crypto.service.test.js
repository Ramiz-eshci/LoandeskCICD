'use strict';

/**
 * crypto.service - transport encryption (RSA-OAEP key wrap + AES-256-GCM).
 * Uses an in-memory stand-in for the crypto_sessions table so the full
 * handshake -> encrypt -> decrypt round trip runs without a database.
 */

const mockStore = new Map();
jest.mock('../../../config/database', () => ({
  queryNamed: jest.fn(async (_sql, p) => {
    mockStore.set(p.idHash, { key_blob: p.keyBlob, expires_at: p.expiresAt, revoked: 0 });
    return [];
  }),
  query: jest.fn(async (sql, params) => {
    if (sql.startsWith('SELECT')) return mockStore.has(params[0]) ? [mockStore.get(params[0])] : [];
    if (sql.startsWith('UPDATE')) { const r = mockStore.get(params[0]); if (r) r.revoked = 1; return []; }
    return [];
  }),
}));

const crypto = require('crypto');
const svc = require('../../../services/crypto.service');

const hash = (id) => crypto.createHash('sha256').update(String(id)).digest('hex');

/** What the browser does: random AES key, wrapped with the server's RSA public key. */
function clientHandshakeKey(len = 32) {
  const aesKey = crypto.randomBytes(len);
  const wrapped = crypto.publicEncrypt(
    { key: svc.getPublicKeyPem(), oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    aesKey,
  );
  return { aesKey, wrappedB64: wrapped.toString('base64') };
}

beforeEach(() => mockStore.clear());

describe('crypto.service', () => {
  it('exposes an RSA public key in PEM form', () => {
    expect(svc.getPublicKeyPem()).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });

  it('creates a session and stores only a hash of the id + an at-rest-wrapped key', async () => {
    const { aesKey, wrappedB64 } = clientHandshakeKey();
    const { sessionId, expiresAt } = await svc.createSession(wrappedB64);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(mockStore.has(sessionId)).toBe(false);
    const row = mockStore.get(hash(sessionId));
    expect(row).toBeDefined();
    expect(row.key_blob).not.toContain(aesKey.toString('base64'));
    expect(await svc.getSessionKey(sessionId)).toEqual(aesKey);
  });

  it('round-trips a payload: browser key encrypts, server decrypts and vice versa', async () => {
    const { aesKey, wrappedB64 } = clientHandshakeKey();
    const { sessionId } = await svc.createSession(wrappedB64);
    const payload = { loan: 125000.5, name: 'Jane', list: [1, 2, 3] };

    const env = await svc.encryptForSession(sessionId, payload);
    // decrypt as the browser would
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(env.iv, 'base64'));
    d.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]).toString('utf8');
    expect(JSON.parse(plain)).toEqual(payload);

    expect(await svc.decryptForSession(sessionId, env)).toEqual(payload);
  });

  it('uses a fresh IV for every message', async () => {
    const { wrappedB64 } = clientHandshakeKey();
    const { sessionId } = await svc.createSession(wrappedB64);
    const a = await svc.encryptForSession(sessionId, { x: 1 });
    const b = await svc.encryptForSession(sessionId, { x: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a tampered ciphertext (GCM auth tag)', async () => {
    const { wrappedB64 } = clientHandshakeKey();
    const { sessionId } = await svc.createSession(wrappedB64);
    const env = await svc.encryptForSession(sessionId, { amount: 100 });
    const bytes = Buffer.from(env.data, 'base64');
    bytes[0] ^= 0xff;
    await expect(svc.decryptForSession(sessionId, { ...env, data: bytes.toString('base64') })).rejects.toThrow();
  });

  it('rejects a key that cannot be unwrapped or is not AES-256', async () => {
    await expect(svc.createSession(Buffer.from('garbage').toString('base64'))).rejects.toMatchObject({ code: svc.CODES.INVALID });
    await expect(svc.createSession(clientHandshakeKey(16).wrappedB64)).rejects.toMatchObject({ code: svc.CODES.INVALID });
  });

  it('maps missing / unknown / revoked / expired sessions to typed codes', async () => {
    await expect(svc.getSessionKey()).rejects.toMatchObject({ code: svc.CODES.NO_SESSION });
    await expect(svc.getSessionKey('nope')).rejects.toMatchObject({ code: svc.CODES.INVALID });

    const { sessionId } = await svc.createSession(clientHandshakeKey().wrappedB64);
    await svc.revokeSession(sessionId);
    await expect(svc.getSessionKey(sessionId)).rejects.toMatchObject({ code: svc.CODES.REVOKED });

    const s2 = await svc.createSession(clientHandshakeKey().wrappedB64);
    mockStore.get(hash(s2.sessionId)).expires_at = new Date(Date.now() - 1000);
    await expect(svc.getSessionKey(s2.sessionId)).rejects.toMatchObject({ code: svc.CODES.EXPIRED });
  });

  it('validateSession never throws and hides infrastructure errors', async () => {
    const db = require('../../../config/database');
    expect(await svc.validateSession('nope')).toEqual({ valid: false, code: svc.CODES.INVALID });
    db.query.mockRejectedValueOnce(new Error('ESOCKET'));
    expect(await svc.validateSession('x')).toEqual({ valid: false, code: svc.CODES.INVALID });
    const { sessionId } = await svc.createSession(clientHandshakeKey().wrappedB64);
    expect(await svc.validateSession(sessionId)).toEqual({ valid: true });
  });
});
