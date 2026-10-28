'use strict';

/**
 * Seeder: "All Underwriting" (UNDERWRITING.ALL_CASES) — the see-everything
 * permission for the underwriting list, mirroring ENQUIRIES.ALL_ENQUIRIES.
 *
 * Without it a user sees the cases nobody has accepted yet plus the ones they
 * are the underwriter on; with it they see every case. The list itself stays
 * guarded by UNDERWRITING.CASE.view — this only widens the scope.
 *
 * Baseline grants by FIXED role id, matching the enquiry see-all set:
 *   1 System Administrator, 3 Underwriter, 4 Credit Manager,
 *   8 Branch Manager, 10 Auditor, 12 Head of Sales.
 * Everyone else is scoped to their own cases until an admin ticks the box.
 *
 * Additive and idempotent.
 */

const SEE_ALL_ROLE_IDS = [1, 3, 4, 8, 10, 12];

module.exports = {
  async run(db) {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'UNDERWRITING.ALL_CASES')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order)
         VALUES ('UNDERWRITING.ALL_CASES', N'All Underwriting', 'UNDERWRITING', 2);
       ELSE
         UPDATE modules SET module_name = N'All Underwriting', parent_code = 'UNDERWRITING' WHERE module_code = 'UNDERWRITING.ALL_CASES';`);

    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'UNDERWRITING.ALL_CASES' AND permission_key = 'view')
         INSERT INTO permissions (module_key, permission_key, description)
         VALUES ('UNDERWRITING.ALL_CASES', 'view', 'See every underwriting case, not only your own');`);

    for (const rid of SEE_ALL_ROLE_IDS) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key='UNDERWRITING.ALL_CASES' AND permission_key='view');
         IF @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@p0 AND permission_id=@p)
           INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
        [rid]);
    }
  },
};
