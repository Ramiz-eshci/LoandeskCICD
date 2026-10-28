'use strict';

/**
 * Route security sweep (pen-test regression guard).
 *
 * Walks EVERY route mounted in app.js and proves:
 *  1. only an explicit, reviewed allowlist of routes is public;
 *  2. every other route rejects a request with no / a bad token (401);
 *  3. a signed-in user whose role has NO permissions is refused (403, or 404
 *     where a scope guard hides the record) on everything except a small,
 *     reviewed list of self-service endpoints - never a 2xx, never a 5xx.
 *
 * Adding a route without `authenticate` (or without an RBAC/scope guard) makes
 * this suite fail until the route is reviewed and added to the lists below.
 */

jest.mock('../../config/database', () => ({
  query: jest.fn().mockResolvedValue([]),
  queryNamed: jest.fn().mockResolvedValue([]),
  getPool: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

// The sweep fires ~1,600 requests from one IP; lift the global limiter for this
// file only (rate limiting itself is covered in tests/unit/middlewares/rate-limit.test.js).
process.env.RATE_LIMIT_MAX = '1000000';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { listRoutes } = require('./route-inventory');

/** Routes that are intentionally reachable without a JWT. */
const PUBLIC_ROUTES = [
  'POST /api/demo-requests',               // website demo form (own limiter + validation)
  'GET /api/crypto/public-key',            // transport-encryption handshake
  'POST /api/crypto/session',
  'GET /api/crypto/session/validate',
  'POST /api/auth/login',
  'POST /api/auth/verify-otp',
  'POST /api/auth/resend-otp',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password/validate',
  'POST /api/auth/reset-password',
  'POST /api/auth/refresh',                // httpOnly refresh cookie + CSRF double-submit
  'POST /api/auth/logout',
  'GET /api/example/ping',                 // development only (not mounted in production)
  'POST /api/example/echo',
  'POST /api/outlook/webhook',             // Microsoft Graph change notifications
  'POST /api/outlook/lifecycle',
].sort();

/** Authenticated routes any signed-in user may call (scoped to themselves). */
const SELF_SERVICE = [
  'GET /api/auth/me',
  'POST /api/auth/select-role',
  // My Profile (client 26-10-2026) - own account only (req.userData.userId).
  'GET /api/auth/profile',
  'PUT /api/auth/profile',
  'POST /api/auth/profile/password',
  'PUT /api/auth/profile/avatar',
  'GET /api/example/whoami',
  'GET /api/notifications',
  'GET /api/notifications/unread-count',
  'PATCH /api/notifications/:id/read',
  'POST /api/notifications/read-all',
  'GET /api/modules',
  'GET /api/dashbord',
];

let app;
let config;
let routes;

beforeAll(() => {
  app = require('../../app');
  config = require('../../config/env').config;
  routes = listRoutes();
});

const call = (r) => request(app)[r.method](r.url).send({});

describe('route inventory', () => {
  it('finds the mounted routers', () => {
    expect(routes.length).toBeGreaterThan(250);
  });

  it('only the reviewed allowlist is public', () => {
    const publicNow = routes.filter((r) => !r.authed).map((r) => r.key.replace(/\/$/, '')).sort();
    expect(publicNow).toEqual(PUBLIC_ROUTES);
  });
});

describe('unauthenticated access', () => {
  it('every protected route returns 401 without a token', async () => {
    const leaks = [];
    for (const r of routes.filter((x) => x.authed)) {
      const res = await call(r);
      if (res.status !== 401) leaks.push(`${r.key} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it.each([
    ['signed with the wrong secret', () => jwt.sign({ userId: 1, roleId: 1, isSuperAdmin: true }, 'not-the-secret')],
    ['expired', () => jwt.sign({ userId: 1, roleId: 1, isSuperAdmin: true, exp: Math.floor(Date.now() / 1000) - 60 }, config.jwt.secret)],
    ['alg=none', () => `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"userId":1,"isSuperAdmin":true}').toString('base64url')}.`],
    ['malformed', () => 'abc.def.ghi'],
  ])('every protected route returns 401 for a token %s', async (_label, makeToken) => {
    const token = makeToken();
    const leaks = [];
    for (const r of routes.filter((x) => x.authed)) {
      const res = await call(r).set('Authorization', `Bearer ${token}`);
      if (res.status !== 401) leaks.push(`${r.key} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });
});

describe('authorisation (role with no permissions)', () => {
  it('is refused everywhere except the self-service endpoints', async () => {
    const token = jwt.sign({ userId: 9999, email: 'nobody@test', roleId: 9999 }, config.jwt.secret, { expiresIn: '5m' });
    const problems = [];
    for (const r of routes.filter((x) => x.authed)) {
      const res = await call(r).set('Authorization', `Bearer ${token}`);
      const selfService = SELF_SERVICE.includes(r.key.replace(/\/$/, ''));
      if (res.status >= 500) problems.push(`${r.key} -> ${res.status} (server error)`);
      else if (!selfService && ![403, 404].includes(res.status)) problems.push(`${r.key} -> ${res.status}`);
    }
    expect(problems).toEqual([]);
  });
});
