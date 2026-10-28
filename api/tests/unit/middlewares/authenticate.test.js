'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../../../config/env');
const authenticate = require('../../../middlewares/authenticate');

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('middleware/authenticate', () => {
  it('401 when the Authorization header is missing', () => {
    const res = mockRes();
    const next = jest.fn();
    authenticate({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Authorization token missing');
    expect(next).not.toHaveBeenCalled();
  });

  it('401 on an invalid token', () => {
    const res = mockRes();
    const next = jest.fn();
    authenticate({ headers: { authorization: 'Bearer not.a.jwt' } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Authorization failed');
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.userData and calls next on a valid token', () => {
    const token = jwt.sign(
      { userId: 7, email: 'a@b.com', roleId: 3, isSuperAdmin: true, companyId: 2 },
      config.jwt.secret,
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.userData).toMatchObject({ userId: 7, email: 'a@b.com', roleId: 3, isSuperAdmin: true, companyId: 2 });
    expect(req.userData.isCompanyAdmin).toBe(false);
  });
});
