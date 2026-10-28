'use strict';

const request = require('supertest');

jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({ logRequestError: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

let app;
let db;
let config;
const body = { name: 'Jane Smith', email: 'jane@firm.co.uk', company: 'Example Lender', interest: 'Full platform', message: '' };
const reference = 'b4f4f87a-6f4e-4f7d-a6ee-0b5d0fa3bcca';

beforeEach(() => {
  jest.resetModules();
  app = require('../app');
  db = require('../config/database');
  config = require('../config/env').config;
  db.query.mockResolvedValue([{ request_ref: reference }]);
});

it('saves a website demo request without authentication, including with staff encryption enabled', async () => {
  config.crypto.enabled = true;
  const res = await request(app).post('/api/demo-requests').set('Origin', 'http://localhost:4200').send(body);
  expect(res.status).toBe(201);
  expect(res.body.status).toBe(true);
  expect(res.body.data).toEqual({ request_ref: reference });
  expect(res.body.encrypted).toBeUndefined();
  expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
  expect(db.query.mock.calls[0][0]).toContain('demo_requests');
  const privateResponse = await request(app).get('/api/enquiries');
  expect(privateResponse.status).toBe(401);
});

it('returns field errors before any database write', async () => {
  const res = await request(app).post('/api/demo-requests').send({ ...body, company: '', email: 'bad' });
  expect(res.status).toBe(400);
  expect(res.body.errors).toHaveProperty('company');
  expect(res.body.errors).toHaveProperty('email');
  expect(db.query).not.toHaveBeenCalled();
});

it('does not expose database errors or report a failed insert as successful', async () => {
  db.query.mockRejectedValue(new Error('SQL failure with private schema details'));
  const res = await request(app).post('/api/demo-requests').send(body);
  expect(res.status).toBe(500);
  expect(res.body.status).toBe(false);
  expect(res.body.message).toBe('Unable to save your demo request. Please try again.');
  expect(JSON.stringify(res.body)).not.toContain('private schema');
});

it('rejects malformed and oversized JSON with appropriate status codes', async () => {
  const malformed = await request(app).post('/api/demo-requests').set('Content-Type', 'application/json').send('{"name":');
  expect(malformed.status).toBe(400);
  const oversized = await request(app).post('/api/demo-requests').send({ ...body, message: 'x'.repeat(17000) });
  expect(oversized.status).toBe(413);
  expect(db.query).not.toHaveBeenCalled();
});

it('rejects arrays, wrong field types and invalid interests', async () => {
  for (const payload of [[], { ...body, name: [] }, { ...body, interest: 'Loan application' }]) {
    const res = await request(app).post('/api/demo-requests').send(payload);
    expect(res.status).toBe(400);
  }
  expect(db.query).not.toHaveBeenCalled();
});

it('limits repeated public submissions', async () => {
  for (let i = 0; i < 10; i += 1) {
    expect((await request(app).post('/api/demo-requests').send(body)).status).toBe(201);
  }
  const res = await request(app).post('/api/demo-requests').send(body);
  expect(res.status).toBe(429);
  expect(db.query).toHaveBeenCalledTimes(10);
});

it('has no public read endpoint and removes the retired borrower form endpoint', async () => {
  expect((await request(app).get('/api/demo-requests')).status).toBe(404);
  expect((await request(app).post('/api/enquiries/public').send(body)).status).toBe(404);
  expect(db.query).not.toHaveBeenCalled();
});
