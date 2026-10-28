'use strict';

/**
 * Pen-test fix (24-10-2026): anonymous requests can't send large bodies; signed-in staff
 * uploads (base64 JSON) still can. Limits come from JSON_BODY_LIMIT / UPLOAD_BODY_LIMIT.
 */

jest.mock('../../config/database', () => ({ query: jest.fn().mockResolvedValue([]), queryNamed: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.setTimeout(60000);

process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const request = require('supertest');
const jwt = require('jsonwebtoken');

let app;
let config;
beforeAll(() => {
  app = require('../../app');
  config = require('../../config/env').config;
}, 60000);

const bigBody = (mb) => ({ email: 'a@b.com', password: 'x', pad: 'A'.repeat(mb * 1024 * 1024) });
const token = (opts = {}) => jwt.sign({ userId: 1, roleId: 1, isSuperAdmin: true }, config.jwt.secret, opts);

describe('body size limits', () => {
  it('defaults: 2mb anonymous, 100mb signed-in', () => {
    expect(config.body).toEqual({ jsonLimit: process.env.JSON_BODY_LIMIT || '2mb', uploadLimit: process.env.UPLOAD_BODY_LIMIT || '100mb' });
  });

  it('anonymous: a 3 MB login body is refused with 413 (not parsed, not 500)', async () => {
    const res = await request(app).post('/api/auth/login').send(bigBody(3));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ status: false, message: 'Request is too large' });
  });

  it('anonymous: normal-sized requests are unaffected', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nope', password: '' });
    expect(res.status).toBe(400);
  });

  it('a forged token does not unlock the large limit', async () => {
    const forged = jwt.sign({ userId: 1, isSuperAdmin: true }, 'not-our-secret');
    const res = await request(app).post('/api/notifications/read-all').set('Authorization', `Bearer ${forged}`).send(bigBody(3));
    expect(res.status).toBe(413);
  });

  it('signed-in staff can send a large (upload-sized) body', async () => {
    const res = await request(app).post('/api/notifications/read-all').set('Authorization', `Bearer ${token({ expiresIn: '5m' })}`).send(bigBody(30));
    expect(res.status).toBe(200);
  });

  it('an EXPIRED token still gets the large limit, then 401 (so the app refreshes and retries)', async () => {
    const expired = token({ expiresIn: -10 });
    const res = await request(app).post('/api/notifications/read-all').set('Authorization', `Bearer ${expired}`).send(bigBody(5));
    expect(res.status).toBe(401);
  });

  it('malformed JSON is a 400, not a 500', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid request body');
  });
});
