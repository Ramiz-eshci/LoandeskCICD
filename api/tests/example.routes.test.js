'use strict';

const request = require('supertest');
const app = require('../app');

describe('example routes', () => {
  it('GET /api/example/ping -> 200 pong', async () => {
    const res = await request(app).get('/api/example/ping');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.message).toBe('pong');
    expect(res.body.data.service).toBe('loandesk-api');
  });

  it('POST /api/example/echo -> echoes body', async () => {
    const res = await request(app).post('/api/example/echo').send({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.body.data.received).toEqual({ hello: 'world' });
  });

  it('GET /api/health -> ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('ok');
  });

  it('unknown route -> 404 uniform body', async () => {
    const res = await request(app).get('/api/nope/nope');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe(false);
  });
});
