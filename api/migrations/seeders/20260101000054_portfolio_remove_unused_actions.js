'use strict';

/**
 * Seeder: Portfolio group — remove Roles-matrix checkboxes that nothing checks.
 * (Verified against portfolio.routes.js / portfolio.controller.js and the Angular
 * portfolio screens.) Their role grants + permission rows are deleted, so the
 * matrix shows "-". A screen left with no permission at all drops out of the matrix.
 *
 *   PORTFOLIO                                   approve, reject, export
 *   PORTFOLIO.CUSTOMER_CONVERSION               all  (no screen / API)
 *   PORTFOLIO.INTRODUCE_MAIL_CHECBOX_FOR_COMPLETED_MEETING   all  (no screen / API)
 *   PORTFOLIO.CUSTOMER_360                      all  (Customer 360 uses the CUSTOMERS module)
 *   PORTFOLIO.EXTENSION                         edit, approve, reject (decision is in Credit)
 *   PORTFOLIO.FURTHER_ADVANCE                   edit, approve, reject (decision is in Credit)
 *   PORTFOLIO.EXIT_FEE                          approve
 * Idempotent.
 */

module.exports = {
  async run(db) {
    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @drop TABLE (module_key NVARCHAR(100), permission_key NVARCHAR(50));
INSERT INTO @drop VALUES
  ('PORTFOLIO','approve'), ('PORTFOLIO','reject'), ('PORTFOLIO','export'),
  ('PORTFOLIO.EXTENSION','edit'), ('PORTFOLIO.EXTENSION','approve'), ('PORTFOLIO.EXTENSION','reject'),
  ('PORTFOLIO.FURTHER_ADVANCE','edit'), ('PORTFOLIO.FURTHER_ADVANCE','approve'), ('PORTFOLIO.FURTHER_ADVANCE','reject'),
  ('PORTFOLIO.EXIT_FEE','approve');

DECLARE @ids TABLE (permission_id INT PRIMARY KEY);
INSERT INTO @ids
SELECT p.permission_id FROM permissions p
 WHERE EXISTS (SELECT 1 FROM @drop d WHERE d.module_key = p.module_key AND d.permission_key = LOWER(p.permission_key))
    OR p.module_key IN ('PORTFOLIO.CUSTOMER_CONVERSION',
                        'PORTFOLIO.INTRODUCE_MAIL_CHECBOX_FOR_COMPLETED_MEETING',
                        'PORTFOLIO.CUSTOMER_360');

DELETE rp FROM role_permissions rp JOIN @ids i ON i.permission_id = rp.permission_id;
DECLARE @grants INT = @@ROWCOUNT;
DELETE p FROM permissions p JOIN @ids i ON i.permission_id = p.permission_id;
DECLARE @perms INT = @@ROWCOUNT;
COMMIT;
SELECT @grants AS grants_removed, @perms AS rows_removed;`);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    portfolio: -${r.grants_removed || 0} grants, -${r.rows_removed || 0} unused permission rows`);
  },
};
