'use strict';
/**
 * Pen-test 24-10-2026 (R2): request input that names an Object.prototype member
 * (constructor, __proto__, toString ...) must never reach a map lookup as an
 * inherited property. Before the fix these returned HTTP 500.
 */
jest.mock('../../config/database', () => ({
  query: jest.fn(async () => []), queryNamed: jest.fn(async () => []), getPool: jest.fn(), transaction: jest.fn(),
}));
jest.setTimeout(60000);
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { own } = require('../../utils/own');
const { RESERVED } = require('../../middlewares/path-guard');

let app; let tok;
beforeAll(() => {
  app = require('../../app');
  const { config } = require('../../config/env');
  tok = jwt.sign({ userId: 1, roleId: 1, isSuperAdmin: true }, config.jwt.secret, { expiresIn: '5m' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('own()', () => {
  const M = { a: 1 };
  it('returns own properties only', () => {
    expect(own(M, 'a')).toBe(1);
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) expect(own(M, k)).toBeUndefined();
    expect(own(M, 1)).toBeUndefined();
    expect(own(null, 'a')).toBeUndefined();
  });
});

describe('reserved path segments', () => {
  const urls = [
    ['get', '/api/masters/constructor'], ['post', '/api/masters/constructor'],
    ['get', '/api/masters/__proto__'], ['get', '/api/email-settings/constructor'],
    ['get', '/api/email-settings/toString'], ['get', '/api/reports/module/constructor'],
    ['get', '/api/reports/module/%5F%5Fproto%5F%5F'], ['get', '/api/enquiry/valueOf'],
  ];
  it.each(urls)('%s %s -> 404, never 500', async (m, u) => {
    const res = await request(app)[m](u).set('Authorization', `Bearer ${tok}`).send({});
    expect(res.status).toBe(404);
  });
  it('covers all Object.prototype names', () => {
    for (const k of Object.getOwnPropertyNames(Object.prototype)) expect(RESERVED.has(k)).toBe(true);
  });
  it('does not block ordinary segments', async () => {
    const res = await request(app).get('/api/masters/not-a-master').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Unknown master/);
  });
});

describe('service lookups ignore inherited keys (defence in depth)', () => {
  it('reports.moduleReport rejects constructor with 400', async () => {
    const svc = require('../../services/reports.service');
    await expect(svc.moduleReport({ userData: { isSuperAdmin: true } }, 'constructor', {})).rejects.toMatchObject({ status: 400 });
  });
  it('emailEvents.varsFor(constructor) is empty', () => {
    expect(require('../../config/emailEvents.config').varsFor('constructor')).toEqual([]);
  });
  it('email history tolerates a missing summary row and junk paging', async () => {
    const svc = require('../../services/emailSettings.service');
    const r = await svc.history({ page: '-5', per_page: 'abc', module: 'constructor', event: '__proto__' });
    expect(r.summary).toMatchObject({ total: 0 });
  });
});
