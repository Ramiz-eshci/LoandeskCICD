'use strict';

jest.mock('../../../utils/logger', () => ({ logRequestError: jest.fn(), warn: jest.fn() }));
const { notFound, errorHandler } = require('../../../middlewares/error-handler');
const logger = require('../../../utils/logger');

function mockRes() {
  return {
    statusCode: null, body: null, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('middleware/error-handler', () => {
  it('notFound -> 404 uniform body', () => {
    const res = mockRes();
    notFound({}, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.status).toBe(false);
  });

  it('errorHandler logs and returns 500 with the message (non-prod)', () => {
    const res = mockRes();
    errorHandler(new Error('kaboom'), { method: 'GET', originalUrl: '/x' }, res, jest.fn());
    expect(logger.logRequestError).toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('kaboom');
  });

  it('does nothing further when headers are already sent', () => {
    const res = mockRes();
    res.headersSent = true;
    errorHandler(new Error('late'), {}, res, jest.fn());
    expect(res.statusCode).toBeNull();
  });
});

describe('middleware/error-handler client errors (pen-test 24-10-2026)', () => {
  it.each([
    [{ status: 400, type: 'entity.parse.failed', expose: true }, 400, 'Invalid request body'],
    [{ status: 413, type: 'entity.too.large', expose: true }, 413, 'Request is too large'],
    [{ statusCode: 415, expose: true }, 415, 'Unsupported request encoding'],
    [{ status: 404, expose: true }, 404, 'Bad Request'],
  ])('keeps the 4xx status for %o', (props, code, message) => {
    const res = mockRes();
    errorHandler(Object.assign(new Error('internal detail'), props), {}, res, jest.fn());
    expect(res.statusCode).toBe(code);
    expect(res.body).toMatchObject({ status: false, message });
    expect(JSON.stringify(res.body)).not.toContain('internal detail');
  });

  it('5xx and plain errors still become 500', () => {
    const res = mockRes();
    errorHandler(Object.assign(new Error('db down'), { status: 503 }), {}, res, jest.fn());
    expect(res.statusCode).toBe(500);
  });
});
