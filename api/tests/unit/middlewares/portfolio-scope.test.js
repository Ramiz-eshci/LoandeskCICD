'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
jest.mock('../../../middlewares/rbac', () => ({ roleHasPermission: jest.fn() }));

const db = require('../../../config/database');
const { roleHasPermission } = require('../../../middlewares/rbac');
const scope = require('../../../middlewares/portfolio-scope');

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('portfolio-scope / scope resolution', () => {
  it('admins are unrestricted on both portfolio and customers', async () => {
    expect(await scope.portfolioScopeUserId({ userData: { isSuperAdmin: true } })).toBeNull();
    expect(await scope.customerScopeUserId({ userData: { isCompanyAdmin: true } })).toBeNull();
  });
  it('scopes to the user when the ALL permission is absent', async () => {
    roleHasPermission.mockResolvedValueOnce(false);
    expect(await scope.portfolioScopeUserId({ userData: { roleId: 2, userId: 8 } })).toBe(8);
  });
});

describe('portfolio-scope / relatedSql', () => {
  it('builds a predicate across BDM, underwriter and enquiry assignee', () => {
    const sql = scope.relatedSql('a', 'uid');
    expect(sql).toContain('a.assigned_to = @uid');
    expect(sql).toContain('underwriting_cases');
    expect(sql).toContain('enquiries');
  });
});

describe('portfolio-scope / requireFacilityInScope', () => {
  it('passes through for an unrestricted caller', async () => {
    const next = jest.fn();
    await scope.requireFacilityInScope({ userData: { isSuperAdmin: true }, params: { id: '1' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('404 when the facility is missing', async () => {
    roleHasPermission.mockResolvedValueOnce(false);
    db.queryNamed.mockResolvedValueOnce([]);
    const res = mockRes();
    await scope.requireFacilityInScope({ userData: { roleId: 2, userId: 5 }, params: { id: 'LN-1' } }, res, jest.fn());
    expect(res.statusCode).toBe(404);
  });
  it('403 when out of scope, allow when ok=1', async () => {
    roleHasPermission.mockResolvedValue(false);
    db.queryNamed.mockResolvedValueOnce([{ ok: 0 }]);
    const res = mockRes();
    await scope.requireFacilityInScope({ userData: { roleId: 2, userId: 5 }, params: { id: 'LN-1' } }, res, jest.fn());
    expect(res.statusCode).toBe(403);

    db.queryNamed.mockResolvedValueOnce([{ ok: 1 }]);
    const next = jest.fn();
    await scope.requireFacilityInScope({ userData: { roleId: 2, userId: 5 }, params: { id: 'LN-1' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
