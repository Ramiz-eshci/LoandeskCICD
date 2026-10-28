'use strict';

/**
 * Hybrid RSA + AES-GCM transport encryption service.
 * (Ported from the INED-AI Python crypto_service.py — same wire format.)
 *
 * Handshake (per browser tab, one-time):
 *   1. Client GET /api/crypto/public-key   -> RSA-2048 public key (PEM/SPKI)
 *   2. Client generates a random AES-256 key locally
 *   3. Client wraps it with RSA-OAEP/SHA-256, POST /api/crypto/session
 *   4. Server unwraps with its private key, stores it, returns sessionId
 *   5. Later requests send header X-Session-Id; bodies/responses use AES-GCM
 *
 * Wire envelope:
 *   { "encrypted": true, "data": "<b64 ct>", "meta": { "iv": "<b64>", "tag": "<b64>", "timestamp": "..." } }
 *
 * Crypto params (MUST match the Angular side byte-for-byte):
 *   RSA  : 2048-bit, e=65537, OAEP, MGF1+SHA-256
 *   AES  : AES-256-GCM, 96-bit (12-byte) random IV, 16-byte tag (split out)
 *   Enc  : base64 for binary on the wire; PEM/SPKI for public key
 *   Body : JSON.stringify -> UTF-8 bytes
 *
 * Keys NEVER leave the server. The RSA private key lives only in memory.
 * The browser AES key is stored ENCRYPTED AT REST (AES-GCM w/ master key),
 * keyed by SHA-256(sessionId).
 */

const crypto = require('crypto');
const { randomUUID, createHash } = crypto;
const db = require('../config/database');
const { config } = require('../config/env');

// ---- typed error codes (frontend interceptor keys off these) ----
const CODES = {
  NO_SESSION: 'NO_CRYPTO_SESSION',
  EXPIRED: 'CRYPTO_SESSION_EXPIRED',
  INVALID: 'CRYPTO_SESSION_INVALID',
  REVOKED: 'CRYPTO_SESSION_REVOKED',
};

class CryptoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// ---- RSA keypair: generated once at process start, private key in-memory only ----
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
});
const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

// ---- master key (for at-rest encryption of session AES keys) ----
function parseMasterKey(raw) {
  if (!raw) {
    // dev fallback: derive deterministically from SECRET_KEY so dev works
    if (config.isProd) {
      throw new Error('CRYPTO_SESSION_MASTER_KEY required in production');
    }
    return createHash('sha256').update(String(config.sessionSecret || 'dev')).digest();
  }
  // try hex (64 chars), else base64 / base64url
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (b.length !== 32) {
    throw new Error('CRYPTO_SESSION_MASTER_KEY must decode to 32 bytes (got ' + b.length + ')');
  }
  return b;
}
const MASTER_KEY = parseMasterKey(config.crypto.masterKey);

// ---- low level AES-GCM ----
function aesGcmEncrypt(key, plaintextBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, iv, tag };
}
function aesGcmDecrypt(key, ctBuf, ivBuf, tagBuf) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
  decipher.setAuthTag(tagBuf);
  return Buffer.concat([decipher.update(ctBuf), decipher.final()]);
}

// ---- at-rest wrapping of the browser AES key ----
function wrapKeyAtRest(aesKey) {
  const { ct, iv, tag } = aesGcmEncrypt(MASTER_KEY, aesKey);
  // store as iv:tag:ct all base64, colon separated
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}
function unwrapKeyAtRest(blob) {
  const [ivB64, tagB64, ctB64] = String(blob).split(':');
  return aesGcmDecrypt(
    MASTER_KEY,
    Buffer.from(ctB64, 'base64'),
    Buffer.from(ivB64, 'base64'),
    Buffer.from(tagB64, 'base64')
  );
}

const hashSessionId = (id) => createHash('sha256').update(String(id)).digest('hex');

// ---- public API ----

function getPublicKeyPem() {
  return PUBLIC_KEY_PEM;
}

/**
 * Unwrap a client-supplied RSA-wrapped AES key, persist it, return a sessionId.
 * @param {string} encryptedKeyB64 base64 RSA-OAEP(SHA-256) wrapped AES-256 key
 */
async function createSession(encryptedKeyB64) {
  const wrapped = Buffer.from(encryptedKeyB64, 'base64');
  let aesKey;
  try {
    aesKey = crypto.privateDecrypt(
      { key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      wrapped
    );
  } catch (e) {
    throw new CryptoError(CODES.INVALID, 'Unable to unwrap session key');
  }
  if (aesKey.length !== 32) {
    throw new CryptoError(CODES.INVALID, 'Session key must be AES-256 (32 bytes)');
  }

  const sessionId = randomUUID();
  const idHash = hashSessionId(sessionId);
  const keyBlob = wrapKeyAtRest(aesKey);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.crypto.sessionTtlSeconds * 1000);

  await db.queryNamed(
    `MERGE crypto_sessions AS t
       USING (SELECT @idHash AS id_hash) AS s ON (t.id_hash = s.id_hash)
     WHEN MATCHED THEN UPDATE SET key_blob=@keyBlob, expires_at=@expiresAt, revoked=0, created_at=@now
     WHEN NOT MATCHED THEN INSERT (id_hash, key_blob, expires_at, revoked, created_at)
                          VALUES (@idHash, @keyBlob, @expiresAt, 0, @now);`,
    { idHash, keyBlob, expiresAt, now }
  );

  return { sessionId, expiresAt: expiresAt.toISOString() };
}

/** Load + validate a session, returning the raw AES key buffer. Throws CryptoError. */
async function getSessionKey(sessionId) {
  if (!sessionId) throw new CryptoError(CODES.NO_SESSION, 'Missing X-Session-Id');
  const idHash = hashSessionId(sessionId);
  const rows = await db.query(
    'SELECT key_blob, expires_at, revoked FROM crypto_sessions WHERE id_hash=@p0',
    [idHash]
  );
  if (!rows.length) throw new CryptoError(CODES.INVALID, 'Unknown session');
  const row = rows[0];
  if (row.revoked) throw new CryptoError(CODES.REVOKED, 'Session revoked');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new CryptoError(CODES.EXPIRED, 'Session expired');
  }
  return unwrapKeyAtRest(row.key_blob);
}

async function validateSession(sessionId) {
  try {
    await getSessionKey(sessionId);
    return { valid: true };
  } catch (e) {
    // only surface typed crypto codes; hide infra errors (e.g. DB ESOCKET)
    const code = e instanceof CryptoError ? e.code : CODES.INVALID;
    return { valid: false, code };
  }
}

async function revokeSession(sessionId) {
  const idHash = hashSessionId(sessionId);
  await db.query('UPDATE crypto_sessions SET revoked=1 WHERE id_hash=@p0', [idHash]);
}

/** Purge expired rows (call from a scheduled job if desired). */
async function purgeExpired() {
  await db.query('DELETE FROM crypto_sessions WHERE expires_at < SYSUTCDATETIME()', []);
}

/**
 * Encrypt a JS value into the wire envelope for a session.
 * @returns { data, iv, tag } base64 strings
 */
async function encryptForSession(sessionId, jsValue) {
  const key = await getSessionKey(sessionId);
  const plaintext = Buffer.from(JSON.stringify(jsValue), 'utf8');
  const { ct, iv, tag } = aesGcmEncrypt(key, plaintext);
  return { data: ct.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

/**
 * Decrypt a wire envelope's { data, iv, tag } back into a JS value.
 */
async function decryptForSession(sessionId, envelope) {
  const key = await getSessionKey(sessionId);
  const pt = aesGcmDecrypt(
    key,
    Buffer.from(envelope.data, 'base64'),
    Buffer.from(envelope.iv, 'base64'),
    Buffer.from(envelope.tag, 'base64')
  );
  return JSON.parse(pt.toString('utf8'));
}

module.exports = {
  CODES,
  CryptoError,
  getPublicKeyPem,
  createSession,
  getSessionKey,
  validateSession,
  revokeSession,
  purgeExpired,
  encryptForSession,
  decryptForSession,
};
