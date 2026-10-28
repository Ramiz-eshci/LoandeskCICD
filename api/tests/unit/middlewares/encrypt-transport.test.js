'use strict';

/** encrypt-request / encrypt-response middlewares with encryption switched ON. */

jest.mock('../../../services/crypto.service', () => ({
  CODES: { NO_SESSION: 'NO_CRYPTO_SESSION', INVALID: 'CRYPTO_SESSION_INVALID' },
  decryptForSession: jest.fn(),
  encryptForSession: jest.fn(),
}));

const cryptoService = require('../../../services/crypto.service');
const { config } = require('../../../config/env');
const decryptRequest = require('../../../middlewares/encrypt-request');
const encryptResponse = require('../../../middlewares/encrypt-response');

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
}
const flush = () => new Promise((r) => setImmediate(r));
const envelope = { encrypted: true, data: 'ZGF0YQ==', meta: { iv: 'aXY=', tag: 'dGFn' } };

let saved;
beforeEach(() => { saved = config.crypto.enabled; config.crypto.enabled = true; });
afterEach(() => { config.crypto.enabled = saved; });

describe('middleware/encrypt-request', () => {
  it('is a pass-through when encryption is disabled', async () => {
    config.crypto.enabled = false;
    const next = jest.fn();
    await decryptRequest()({ path: '/api/x', headers: {}, body: envelope }, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(cryptoService.decryptForSession).not.toHaveBeenCalled();
  });

  it.each([
    ['handshake routes', { path: '/api/crypto/session', headers: {}, body: envelope }],
    ['multipart uploads', { path: '/api/x', headers: { 'content-type': 'multipart/form-data; b=1' }, body: envelope }],
    ['plain (non-envelope) bodies', { path: '/api/x', headers: {}, body: { a: 1 } }],
  ])('skips %s', async (_l, req) => {
    const next = jest.fn();
    await decryptRequest()(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(cryptoService.decryptForSession).not.toHaveBeenCalled();
  });

  it('replaces req.body with the decrypted payload', async () => {
    cryptoService.decryptForSession.mockResolvedValueOnce({ name: 'Jane' });
    const req = { path: '/api/x', headers: { 'x-session-id': 'sid' }, body: envelope };
    const next = jest.fn();
    await decryptRequest()(req, mockRes(), next);
    expect(cryptoService.decryptForSession).toHaveBeenCalledWith('sid', { data: 'ZGF0YQ==', iv: 'aXY=', tag: 'dGFn' });
    expect(req.body).toEqual({ name: 'Jane' });
    expect(next).toHaveBeenCalled();
  });

  it('answers 400 with the crypto error code when decryption fails', async () => {
    const err = Object.assign(new Error('Session expired'), { code: 'CRYPTO_SESSION_EXPIRED' });
    cryptoService.decryptForSession.mockRejectedValueOnce(err);
    const res = mockRes();
    const next = jest.fn();
    await decryptRequest()({ path: '/api/x', headers: { 'x-session-id': 's' }, body: envelope }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe(false);
    expect(JSON.stringify(res.body)).toContain('CRYPTO_SESSION_EXPIRED');
  });
});

describe('middleware/encrypt-response', () => {
  function run(req) {
    const res = mockRes();
    const original = res.json;
    const next = jest.fn();
    encryptResponse()(req, res, next);
    return { res, original, next };
  }

  it('leaves handshake and health responses plain', () => {
    for (const p of ['/api/crypto/public-key', '/api/health']) {
      const { res, original, next } = run({ path: p, headers: {} });
      expect(next).toHaveBeenCalled();
      expect(res.json).toBe(original);
    }
  });

  it('encrypts success bodies into the envelope', async () => {
    cryptoService.encryptForSession.mockResolvedValueOnce({ data: 'D', iv: 'I', tag: 'T' });
    const { res, original } = run({ path: '/api/clients', headers: { 'x-session-id': 'sid' } });
    res.json({ status: true, data: [{ id: 1 }] });
    await flush();
    expect(cryptoService.encryptForSession).toHaveBeenCalledWith('sid', { status: true, data: [{ id: 1 }] });
    const sent = original.mock.calls[0][0];
    expect(sent).toMatchObject({ encrypted: true, success: true, data: 'D', meta: { iv: 'I', tag: 'T' } });
    expect(JSON.stringify(sent)).not.toContain('"id":1');
  });

  it('never sends plain data without a session (401 instead)', () => {
    const { res, original } = run({ path: '/api/clients', headers: {} });
    res.json({ status: true, data: ['secret'] });
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(original.mock.calls[0][0])).not.toContain('secret');
  });

  it('returns an error (not the plain payload) when encryption fails', async () => {
    cryptoService.encryptForSession.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'CRYPTO_SESSION_REVOKED' }));
    const { res, original } = run({ path: '/api/clients', headers: { 'x-session-id': 'sid' } });
    res.json({ status: true, data: ['secret'] });
    await flush();
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(original.mock.calls[0][0])).not.toContain('secret');
  });

  it('passes error bodies (>= 400) through unencrypted', () => {
    const { res, original } = run({ path: '/api/clients', headers: { 'x-session-id': 'sid' } });
    res.statusCode = 404;
    res.json({ status: false, message: 'Not found' });
    expect(cryptoService.encryptForSession).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledWith({ status: false, message: 'Not found' });
  });
});
