'use strict';

/**
 * Pen-test fix (24-10-2026): no file on the API server is reachable by URL.
 *  - Express no longer mounts /uploads statically;
 *  - deploy/api-web.config sends every request to Node and hides source / data folders,
 *    so IIS can't serve /uploads/*, /config/env.js, /package.json ... directly.
 */

jest.mock('../../config/database', () => ({ query: jest.fn().mockResolvedValue([]), queryNamed: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.setTimeout(30000);

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const API_ROOT = path.join(__dirname, '..', '..');
const PROBE_DIR = path.join(API_ROOT, 'uploads', 'application_documents');
const PROBE = path.join(PROBE_DIR, `__pentest_probe_${process.pid}.pdf`);

let app;
beforeAll(() => {
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  fs.writeFileSync(PROBE, '%PDF-1.7 SECRET-CUSTOMER-DOCUMENT');
  app = require('../../app');
}, 60000);
afterAll(() => { try { fs.unlinkSync(PROBE); } catch (_) { /* already gone */ } });

describe('Express', () => {
  it.each([
    `/uploads/application_documents/${path.basename(PROBE)}`,
    `/api/uploads/application_documents/${path.basename(PROBE)}`,
    '/uploads/',
  ])('does not serve %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('SECRET-CUSTOMER-DOCUMENT');
  });

  it.each(['/config/env.js', '/package.json', '/.env', '/app.js'])('does not serve source / config %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });
});

describe('deploy/api-web.config (IIS)', () => {
  const file = path.join(API_ROOT, '..', 'deploy', 'api-web.config');
  const xml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const maybe = xml ? it : it.skip;
  const rules = () => [...xml.matchAll(/<rule\b[\s\S]*?<\/rule>/g)].map((m) => m[0]);

  maybe('has no rule that lets IIS serve a file directly', () => {
    for (const r of rules()) {
      expect(r).not.toMatch(/type="None"/);
      expect(r).not.toMatch(/matchType="IsFile"/);
    }
  });

  maybe('rewrites every request to server.js', () => {
    expect(rules().some((r) => /<match url="\.\*"\s*\/>/.test(r) && /<action type="Rewrite" url="server\.js"/.test(r))).toBe(true);
  });

  maybe('iisnode log pages and remote debugging are off', () => {
    expect(xml).toMatch(/loggingEnabled="false"/);
    expect(xml).toMatch(/debuggingEnabled="false"/);
    expect(xml).toMatch(/devErrorsEnabled="false"/);
  });

  maybe.each(['uploads', 'logs', 'iisnode', 'config', 'node_modules', '.env', '.env.live', 'package.json'])('hides the "%s" segment', (seg) => {
    expect(xml).toContain(`<add segment="${seg}" />`);
  });
});
