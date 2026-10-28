'use strict';

/**
 * Dashboard: every logged-in user may call it, so the data protection lives
 * in the service - tiles only for modules the role can view, and rows scoped to
 * the caller unless the role holds the module's ALL_* permission.
 */

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
const db = require('../../../config/database');
const dash = require('../../../services/dashboard.service');

/** db.query stand-in: answers RBAC lookups from `perms`, data queries with one row. */
function wire(perms) {
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM role_permissions')) return perms.has(`${params[1]}:${params[2]}`) ? [{ 1: 1 }] : [];
    return [{ total: 3, last30: 1, open_count: 2, open_value: 500, active_count: 2, active_value: 900, matured30: 0, value: 10 }];
  });
}
const dataQueries = () => db.query.mock.calls.filter(([sql]) => !sql.includes('FROM role_permissions'));
const req = (u) => ({ userData: { userId: 42, roleId: 7, ...u } });

beforeEach(() => db.query.mockReset());

describe('dashboard.summary', () => {
  it('returns no tiles and runs no data query for a role without permissions', async () => {
    wire(new Set());
    const out = await dash.summary(req());
    expect(out.tiles).toEqual([]);
    expect(dataQueries()).toHaveLength(0);
    expect(out.context).toMatchObject({ user_id: 42, role_id: 7, is_admin: false, any_scoped: false });
  });

  it('scopes enquiry tiles to the caller without ENQUIRIES.ALL_ENQUIRIES', async () => {
    wire(new Set(['ENQUIRIES.ENQUIRY_LIST:view']));
    const out = await dash.summary(req());
    expect(out.tiles.map((t) => t.key)).toEqual(['enquiries_new', 'enquiries_open', 'enquiries_value']);
    expect(out.tiles.every((t) => t.scoped)).toBe(true);
    expect(out.context.any_scoped).toBe(true);
    for (const [sql, params] of dataQueries()) {
      expect(sql).toContain('e.assigned_to = @p0');
      expect(params).toEqual([42]);
    }
  });

  it('shows all rows when the role holds the ALL_* permission', async () => {
    wire(new Set(['ENQUIRIES.ENQUIRY_LIST:view', 'ENQUIRIES.ALL_ENQUIRIES:view']));
    const out = await dash.summary(req());
    expect(out.tiles.every((t) => !t.scoped)).toBe(true);
    for (const [sql] of dataQueries()) expect(sql).not.toContain('assigned_to = @p0');
  });

  it('admins see every module unscoped without any RBAC lookup', async () => {
    wire(new Set());
    const out = await dash.summary(req({ isSuperAdmin: true }));
    const modules = [...new Set(out.tiles.map((t) => t.module))];
    expect(modules).toEqual(['ENQUIRIES.ENQUIRY_LIST', 'APPLICATIONS.APPLICATION_LIST', 'UNDERWRITING.CASE', 'PORTFOLIO']);
    expect(out.tiles.some((t) => t.scoped)).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM role_permissions'))).toBe(false);
    expect(out.context.is_admin).toBe(true);
  });

  it('a failing tile query does not break the dashboard', async () => {
    db.query.mockImplementation(async (sql) => { if (sql.includes('FROM role_permissions')) return [{}]; throw new Error('timeout'); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await dash.summary(req());
    expect(out.tiles.length).toBeGreaterThan(0);
    expect(out.tiles.every((t) => t.value === 0)).toBe(true);
    err.mockRestore();
  });
});

describe('dashboard.scopeUserId', () => {
  it('returns null for modules without an ALL_* rule', async () => {
    wire(new Set());
    expect(await dash.scopeUserId(req(), 'PORTFOLIO')).toBeNull();
  });

  it('uses each SCOPE_RULES entry', () => {
    expect(dash.SCOPE_RULES['UNDERWRITING.CASE']).toEqual({ module: 'UNDERWRITING.ALL_CASES', action: 'view' });
  });
});
