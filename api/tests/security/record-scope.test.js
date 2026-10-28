'use strict';

/**
 * Record-level access (IDOR) for enquiry + underwriting /:id routes (pen-test 24-10-2026).
 * A scoped user (no ALL_* permission) must not reach another user's record through ANY
 * /:id action - not just the detail page.
 */

const mockPerms = new Set();
const mockRows = { enquiries: {}, underwriting_cases: {} };
jest.mock('../../config/database', () => ({
  query: jest.fn(async (sql, p = []) => {
    if (sql.includes('FROM role_permissions')) return mockPerms.has(`${p[1]}:${p[2]}`) ? [{ 1: 1 }] : [];
    if (sql.includes('FROM enquiries WHERE enquiry_id')) return mockRows.enquiries[p[0]] ? [mockRows.enquiries[p[0]]] : [];
    if (sql.includes('FROM underwriting_cases WHERE underwriting_case_id')) return mockRows.underwriting_cases[p[0]] ? [mockRows.underwriting_cases[p[0]]] : [];
    return [];
  }),
  queryNamed: jest.fn(async (sql, p = {}) => {
    if (sql.includes('FROM role_permissions')) {
      const pairs = Object.keys(p).filter((k) => /^m\d+$/.test(k)).map((k) => `${p[k]}:${p['a' + k.slice(1)]}`);
      return pairs.some((x) => mockPerms.has(x)) ? [{ ok: 1 }] : [];
    }
    return [];
  }),
  getPool: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.setTimeout(60000);
process.env.RATE_LIMIT_MAX = '1000000';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { listRoutes } = require('./route-inventory');
const { requireEnquiryInScope, requireUwCaseInScope } = require('../../middlewares/record-scope');

let app;
let config;
beforeAll(() => {
  app = require('../../app');
  config = require('../../config/env').config;
}, 60000);

const BDM = 41;
const OTHER = 42;
const tokenFor = (userId) => jwt.sign({ userId, roleId: 7 }, config.jwt.secret, { expiresIn: '5m' });

describe('every enquiry / underwriting /:id route carries the scope guard', () => {
  const routers = { '/api/enquiries': requireEnquiryInScope, '/api/underwriting': requireUwCaseInScope };
  for (const [mount, guard] of Object.entries(routers)) {
    it(mount, () => {
      const router = require(`../../routes/${mount === '/api/enquiries' ? 'enquiry' : 'underwriting'}.routes`);
      const idRoutes = router.stack.filter((l) => l.route && l.route.path.startsWith('/:id'));
      expect(idRoutes.length).toBeGreaterThan(20);
      const missing = idRoutes.filter((l) => !l.route.stack.some((s) => s.handle === guard)).map((l) => l.route.path);
      expect(missing).toEqual([]);
      const masters = router.stack.filter((l) => l.route && /^\/(brokers|solicitors|valuer-firms|borrower-solicitors|solicitor-cost-types)\//.test(l.route.path));
      for (const l of masters) expect(l.route.stack.some((s) => s.handle === guard)).toBe(false);
    });
  }
});

describe('enquiries: scoped BDM', () => {
  beforeEach(() => {
    mockPerms.clear();
    ['view', 'edit', 'add', 'delete'].forEach((a) => mockPerms.add(`ENQUIRIES.ENQUIRY_LIST:${a}`));
    ['view', 'add', 'edit', 'delete'].forEach((a) => mockPerms.add(`ENQUIRIES.DOCUMENTS_UPLOAD:${a}`));
    mockRows.enquiries = { 1: { assigned_to: BDM }, 2: { assigned_to: OTHER } };
  });

  const enquiryIdRoutes = () => listRoutes().filter((r) => r.mount === '/api/enquiries' && r.path.startsWith('/:id'));

  it("is refused (403) on EVERY /:id action of another BDM's enquiry", async () => {
    const leaks = [];
    for (const r of enquiryIdRoutes()) {
      const url = r.url.replace('/api/enquiries/1', '/api/enquiries/2');
      const res = await request(app)[r.method](url).set('Authorization', `Bearer ${tokenFor(BDM)}`).send({});
      if (res.status !== 403 && res.status !== 404) leaks.push(`${r.key} -> ${res.status}`);
      else if (res.status === 403 && res.body.message !== 'This enquiry is not assigned to you'
        && res.body.message !== 'You are not authorized for this action') leaks.push(`${r.key} -> ${res.body.message}`);
    }
    expect(leaks).toEqual([]);
  });

  it('gets past the guard on their own enquiry', async () => {
    const res = await request(app).get('/api/enquiries/1/documents/9/download').set('Authorization', `Bearer ${tokenFor(BDM)}`);
    expect(res.body.message).not.toBe('This enquiry is not assigned to you');
  });

  it('404 for an enquiry that does not exist', async () => {
    const res = await request(app).get('/api/enquiries/999/notes').set('Authorization', `Bearer ${tokenFor(BDM)}`);
    expect(res.status).toBe(404);
  });

  it('ALL_ENQUIRIES holders are not restricted', async () => {
    mockPerms.add('ENQUIRIES.ALL_ENQUIRIES:view');
    const res = await request(app).get('/api/enquiries/2/notes').set('Authorization', `Bearer ${tokenFor(BDM)}`);
    expect(res.body.message).not.toBe('This enquiry is not assigned to you');
  });

  it('ALL_ENQUIRIES holders also get 404 for a deleted (or missing) enquiry', async () => {
    mockPerms.add('ENQUIRIES.ALL_ENQUIRIES:view');
    const res = await request(app).get('/api/enquiries/999/notes').set('Authorization', `Bearer ${tokenFor(BDM)}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Enquiry not found');
  });
});

describe('underwriting: scoped underwriter', () => {
  beforeEach(() => {
    mockPerms.clear();
    ['view', 'edit', 'add', 'delete', 'approve'].forEach((a) => mockPerms.add(`UNDERWRITING.CASE:${a}`));
    mockRows.underwriting_cases = { 1: { underwriter_id: BDM }, 2: { underwriter_id: OTHER }, 3: { underwriter_id: null } };
  });

  it("is refused on EVERY /:id action of another underwriter's case", async () => {
    const leaks = [];
    for (const r of listRoutes().filter((x) => x.mount === '/api/underwriting' && x.path.startsWith('/:id'))) {
      const url = r.url.replace('/api/underwriting/1', '/api/underwriting/2');
      const res = await request(app)[r.method](url).set('Authorization', `Bearer ${tokenFor(BDM)}`).send({});
      if (res.status !== 403 && res.status !== 404) leaks.push(`${r.key} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('can still accept an unassigned case and work on their own', async () => {
    for (const url of ['/api/underwriting/3/accept', '/api/underwriting/1/hold']) {
      const res = await request(app).post(url).set('Authorization', `Bearer ${tokenFor(BDM)}`).send({});
      expect(res.body.message).not.toBe('This underwriting case is assigned to another underwriter');
    }
  });
});
