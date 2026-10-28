'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
const db = require('../../../config/database');
const { requireRole, requirePermission, requireAnyPermission, roleHasPermission } = require('../../../middlewares/rbac');

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('middleware/rbac requireRole', () => {
  it('401 without userData', () => {
    const res = mockRes();
    requireRole(1)({}, res, jest.fn());
    expect(res.statusCode).toBe(401);
  });
  it('super admin bypasses', () => {
    const next = jest.fn();
    requireRole(9)({ userData: { isSuperAdmin: true, roleId: 1 } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('allows a matching role, 403 otherwise', () => {
    const okNext = jest.fn();
    requireRole(3, 4)({ userData: { roleId: 4 } }, mockRes(), okNext);
    expect(okNext).toHaveBeenCalled();

    const res = mockRes();
    requireRole(3, 4)({ userData: { roleId: 9 } }, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });
});

describe('middleware/rbac requirePermission', () => {
  it('admin bypass does not hit the DB', async () => {
    const next = jest.fn();
    await requirePermission('X', 'view')({ userData: { isCompanyAdmin: true } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('allows when the permission row exists', async () => {
    db.query.mockResolvedValueOnce([{ x: 1 }]);
    const next = jest.fn();
    await requirePermission('APP', 'view')({ userData: { roleId: 2 } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('403 when no permission row', async () => {
    db.query.mockResolvedValueOnce([]);
    const res = mockRes();
    await requirePermission('APP', 'view')({ userData: { roleId: 2 } }, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });
  it('forwards a DB error to next(err)', async () => {
    db.query.mockRejectedValueOnce(new Error('boom'));
    const next = jest.fn();
    await requirePermission('APP', 'view')({ userData: { roleId: 2 } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('middleware/rbac requireAnyPermission', () => {
  it('403 when given no pairs', async () => {
    const res = mockRes();
    await requireAnyPermission([])({ userData: { roleId: 2 } }, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });
  it('allows when any pair matches', async () => {
    db.queryNamed.mockResolvedValueOnce([{ ok: 1 }]);
    const next = jest.fn();
    await requireAnyPermission([['A', 'edit'], ['B', 'edit']])({ userData: { roleId: 2 } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('middleware/rbac roleHasPermission', () => {
  it('false for a missing roleId without a query', async () => {
    expect(await roleHasPermission(0, 'A', 'view')).toBe(false);
  });
  it('true/false based on rows', async () => {
    db.query.mockResolvedValueOnce([{ x: 1 }]);
    expect(await roleHasPermission(2, 'A', 'view')).toBe(true);
    db.query.mockResolvedValueOnce([]);
    expect(await roleHasPermission(2, 'A', 'view')).toBe(false);
  });
});
