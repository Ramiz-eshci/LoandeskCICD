'use strict';

const R = require('../services/response.service');

// minimal res mock capturing status + json
function mockRes() {
  return {
    _status: null,
    _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}

describe('services/response.service', () => {
  it('ok() -> 200 with uniform body shape', () => {
    const res = mockRes();
    R.ok(res, 'pong', { a: 1 });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ status: true, success: true, message: 'pong', data: { a: 1 }, errors: null, meta: null });
  });

  it('serverError() -> 500 status:false', () => {
    const res = mockRes();
    R.serverError(res, 'boom');
    expect(res._status).toBe(500);
    expect(res._body.status).toBe(false);
    expect(res._body.message).toBe('boom');
  });
});
