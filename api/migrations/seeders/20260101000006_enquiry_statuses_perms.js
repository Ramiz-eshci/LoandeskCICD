'use strict';

/**
 * Seeder: Enquiry module (Module-4) status catalogue + permission top-ups.
 *
 *  1) enquiry_statuses: the full Module-4 lifecycle
 *       New . Unassigned . Assigned . Contacted . Follow-up . Qualified .
 *       Converted . Lost . Closed
 *     (earlier master_data seeder only had 5). Additive & idempotent.
 *
 *  2) role_permissions: grant ENQUIRIES.ENQUIRY_LIST.assign to Sales / BDM and
 *     Head Sales (the modules matrix only granted 'assign' to Branch Manager).
 *     'convert' is likewise ensured for the sales roles. System Administrator
 *     bypasses RBAC via is_super_admin, so it needs no explicit grant.
 *
 * Runs AFTER 20260101000004_modules_matrix (which creates the ENQUIRY_LIST
 * permission rows). Every write is guarded — safe to run any number of times.
 */

const STATUSES = [
  { code: 'NEW', name: 'New', sort_order: 1, is_terminal: 0 },
  { code: 'UNASSIGNED', name: 'Unassigned', sort_order: 2, is_terminal: 0 },
  { code: 'ASSIGNED', name: 'Assigned', sort_order: 3, is_terminal: 0 },
  { code: 'CONTACTED', name: 'Awaiting Information', sort_order: 4, is_terminal: 0 },
  { code: 'FOLLOW_UP', name: 'Follow-up', sort_order: 5, is_terminal: 0 },
  { code: 'QUALIFIED', name: 'Offer Sent', sort_order: 6, is_terminal: 0 },
  { code: 'OFFER_ACCEPTED', name: 'Offer Accepted', sort_order: 7, is_terminal: 0 },
  { code: 'CONVERTED', name: 'Converted', sort_order: 8, is_terminal: 1 },
  { code: 'LOST', name: 'Declined', sort_order: 9, is_terminal: 1 },
  { code: 'CLOSED', name: 'Closed', sort_order: 10, is_terminal: 1 },
];

// role_name -> actions to ensure on ENQUIRIES.ENQUIRY_LIST
const GRANTS = {
  'Sales / BDM': ['assign', 'convert'],
  'Head Sales': ['assign', 'convert'],
};
const MODULE_KEY = 'ENQUIRIES.ENQUIRY_LIST';

module.exports = {
  async run(db) {
    // 1) statuses (idempotent by code)
    for (const s of STATUSES) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM enquiry_statuses WHERE code = @p0)
           INSERT INTO enquiry_statuses (code, name, sort_order, is_terminal)
           VALUES (@p0, @p1, @p2, @p3);`,
        [s.code, s.name, s.sort_order, s.is_terminal],
      );
      // keep display name + order in sync with this catalogue on every seed
      await db.query(
        `UPDATE enquiry_statuses SET name = @p1, sort_order = @p2 WHERE code = @p0;`,
        [s.code, s.name, s.sort_order],
      );
    }

    // 2) permission top-ups
    for (const role of Object.keys(GRANTS)) {
      for (const act of GRANTS[role]) {
        // ensure the permission row exists (matrix normally created it)
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
             INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
          [MODULE_KEY, act, act + ' ' + MODULE_KEY],
        );
        // additive grant
        await db.query(
          `DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p0);
           DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key=@p1 AND permission_key=@p2);
           IF @r IS NOT NULL AND @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@r AND permission_id=@p)
             INSERT INTO role_permissions (role_id, permission_id) VALUES (@r, @p);`,
          [role, MODULE_KEY, act],
        );
      }
    }
  },
};
