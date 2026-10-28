'use strict';

/**
 * Pen-test fix (24-10-2026): developer-only endpoints are not mounted in production.
 * The app is loaded with NODE_ENV=production (and the local .env ignored).
 */

jest.mock('../../config/database', () => ({ query: jest.fn().mockResolvedValue([]), queryNamed: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.setTimeout(30000);

const request = require('supertest');

function loadApp(nodeEnv) {
  const saved = process.env.NODE_ENV;
  const savedKey = process.env.CRYPTO_SESSION_MASTER_KEY;
  process.env.NODE_ENV = nodeEnv;
  process.env.CRYPTO_SESSION_MASTER_KEY = 'ab'.repeat(32); // production requires a real master key
  let app;
  jest.isolateModules(() => {
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    app = require('../../app');
  });
  process.env.NODE_ENV = saved;
  if (savedKey === undefined) delete process.env.CRYPTO_SESSION_MASTER_KEY; else process.env.CRYPTO_SESSION_MASTER_KEY = savedKey;
  return app;
}

describe('production', () => {
  let app;
  beforeAll(() => { app = loadApp('production'); }, 60000);

  it.each(['/api-docs/', '/api-docs.json', '/api/example/ping', '/api/example/whoami'])('%s is not available', async (url) => {
    expect((await request(app).get(url)).status).toBe(404);
  });

  it('POST /api/example/echo is not available', async () => {
    expect((await request(app).post('/api/example/echo').send({ a: 1 })).status).toBe(404);
  });

  it('real routes still work', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/enquiries')).status).toBe(401);
  });
});

describe('development', () => {
  it('keeps Swagger and the example routes for local work', async () => {
    const app = loadApp('development');
    expect((await request(app).get('/api-docs.json')).status).toBe(200);
    expect((await request(app).get('/api/example/ping')).status).toBe(200);
  }, 60000);
});
