'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
jest.mock('../../../middlewares/rbac', () => ({ roleHasPermission: jest.fn() }));

const db = require('../../../config/database');
const { roleHasPermission } = require('../../../middlewares/rbac');
const scope = require('../../../middlewares/application-scope');

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('application-scope / viewScopeUserId', () => {
  it('admins are unrestricted (null)', async () => {
    expect(await scope.viewScopeUserId({ userData: { isSuperAdmin: true } })).toBeNull();
    expect(await scope.viewScopeUserId({ userData: { isCompanyAdmin: true } })).toBeNull();
  });
  it('a role with ALL_APPLICATIONS.view is unrestricted', async () => {
    roleHasPermission.mockResolvedValueOnce(true);
    expect(await scope.viewScopeUserId({ userData: { roleId: 2, userId: 5 } })).toBeNull();
  });
  it('otherwise scoped to the user id', async () => {
    roleHasPermission.mockResolvedValueOnce(false);
    expect(await scope.viewScopeUserId({ userData: { roleId: 2, userId: 5 } })).toBe(5);
  });
});

describe('application-scope / scopeWhere', () => {
  it('limits rows to the scoped user across the three roles', () => {
    const sql = scope.scopeWhere();
    expect(sql).toContain('a.assigned_to = @scope_uid');
    expect(sql).toContain('a.underwriter_id = @scope_uid');
    expect(sql).toContain('a.credit_manager_id = @scope_uid');
  });
});

describe('application-scope / requireApplicationInScope', () => {
  it('passes straight through for an unrestricted caller', async () => {
    const next = jest.fn();
    await scope.requireApplicationInScope({ userData: { isSuperAdmin: true }, params: { id: '1' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('404 when the application is missing', async () => {
    roleHasPermission.mockResolvedValueOnce(false);
    db.query.mockResolvedValueOnce([]);
    const res = mockRes();
    await scope.requireApplicationInScope({ userData: { roleId: 2, userId: 5 }, params: { id: '9' } }, res, jest.fn());
    expect(res.statusCode).toBe(404);
  });
  it('allows when the user is on the application', async () => {
    roleHasPermission.mockResolvedValueOnce(false);
    db.query.mockResolvedValueOnce([{ assigned_to: 5, underwriter_id: null, credit_manager_id: null }]);
    const next = jest.fn();
    await scope.requireApplicationInScope({ userData: { roleId: 2, userId: 5 }, params: { id: '9' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('403 when the application is outside the scope', async () => {
    roleHasPermission.mockResolvedValueOnce(false);
    db.query.mockResolvedValueOnce([{ assigned_to: 1, underwriter_id: 2, credit_manager_id: 3 }]);
    const res = mockRes();
    await scope.requireApplicationInScope({ userData: { roleId: 2, userId: 5 }, params: { id: '9' } }, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });
});
