'use strict';

const correlation = require('../../../middlewares/correlation');

function mockRes() {
  return {
    headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    json(b) { this.body = b; return this; },
  };
}

describe('middleware/correlation', () => {
  it('generates a correlation id and echoes it on the response', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    correlation()(req, res, next);
    expect(req.correlationId).toBeTruthy();
    expect(res.getHeader('X-Correlation-Id')).toBe(req.correlationId);
    expect(next).toHaveBeenCalled();
  });

  it('reuses an incoming X-Correlation-Id', () => {
    const req = { headers: { 'x-correlation-id': 'abc-123' } };
    const res = mockRes();
    correlation()(req, res, jest.fn());
    expect(req.correlationId).toBe('abc-123');
  });

  it('adds success + correlationId to an object JSON payload', () => {
    const req = { headers: {} };
    const res = mockRes();
    correlation()(req, res, jest.fn());
    res.json({ status: true, message: 'ok' });
    expect(res.body.success).toBe(true);
    expect(res.body.correlationId).toBe(req.correlationId);
  });

  it('leaves array payloads untouched', () => {
    const req = { headers: {} };
    const res = mockRes();
    correlation()(req, res, jest.fn());
    res.json([1, 2, 3]);
    expect(res.body).toEqual([1, 2, 3]);
  });
});
