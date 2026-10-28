'use strict';

/** Rate limiting (brute-force protection) - real express-rate-limit instances. */

process.env.RATE_LIMIT_MAX = '5';
process.env.AUTH_RATE_LIMIT_MAX = '3';

const express = require('express');
const request = require('supertest');

function appWith(limiter) {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/t', limiter, (req, res) => res.json({ ok: true }));
  return app;
}

let limits;
beforeEach(() => {
  jest.resetModules();
  limits = require('../../../middlewares/rate-limit');
});

it('auth limiter blocks after AUTH_RATE_LIMIT_MAX attempts with a JSON 429', async () => {
  const app = appWith(limits.authLimiter);
  for (let i = 0; i < 3; i++) expect((await request(app).post('/t')).status).toBe(200);
  const res = await request(app).post('/t');
  expect(res.status).toBe(429);
  expect(res.body).toMatchObject({ status: false, message: 'Too many attempts, please slow down' });
  expect(res.headers).toHaveProperty('ratelimit-limit');
  expect(res.headers['x-ratelimit-limit']).toBeUndefined();
});

it('limits per client IP (X-Forwarded-For behind IIS)', async () => {
  const app = appWith(limits.authLimiter);
  for (let i = 0; i < 3; i++) await request(app).post('/t').set('X-Forwarded-For', '10.0.0.1');
  expect((await request(app).post('/t').set('X-Forwarded-For', '10.0.0.1')).status).toBe(429);
  expect((await request(app).post('/t').set('X-Forwarded-For', '10.0.0.2')).status).toBe(200);
});

it('global limiter uses RATE_LIMIT_MAX', async () => {
  const app = appWith(limits.globalLimiter);
  for (let i = 0; i < 5; i++) expect((await request(app).post('/t')).status).toBe(200);
  const res = await request(app).post('/t');
  expect(res.status).toBe(429);
  expect(res.body.message).toBe('Too many requests, please try again later');
});

it('demo-request limiter allows 10 per window', async () => {
  const app = appWith(limits.demoRequestLimiter);
  for (let i = 0; i < 10; i++) expect((await request(app).post('/t')).status).toBe(200);
  expect((await request(app).post('/t')).status).toBe(429);
});

it('login, OTP and password routes are wired to the auth limiter', () => {
  const router = require('../../../routes/auth.routes');
  const guarded = router.stack
    .filter((l) => l.route && l.route.stack.some((s) => s.handle === limits.authLimiter))
    .map((l) => l.route.path);
  expect(guarded).toEqual(expect.arrayContaining(['/login', '/verify-otp', '/resend-otp']));
});
