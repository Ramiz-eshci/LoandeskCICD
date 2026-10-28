'use strict';

/**
 * Seeder: Credit module keeps only View, Approve, Reject.
 *
 * CREDIT add / edit / delete / export were never checked anywhere
 * (credit.routes.js uses view, approve, reject only; no Angular screen reads them),
 * so their role grants + permission rows are removed. Hidden `download` is untouched.
 *   View    -> Credit menu, list, Credit Paper
 *   Approve -> Decide (approve / approve with conditions / refer)
 *   Reject  -> Decide (decline)
 * Idempotent.
 */

module.exports = {
  async run(db) {
    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;
DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'CREDIT' AND LOWER(p.permission_key) IN ('add','edit','delete','export');
DECLARE @grants INT = @@ROWCOUNT;
DELETE FROM permissions WHERE module_key = 'CREDIT' AND LOWER(permission_key) IN ('add','edit','delete','export');
DECLARE @rows INT = @@ROWCOUNT;
COMMIT;
SELECT @grants AS grants_removed, @rows AS rows_removed;`);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    credit: -${r.grants_removed || 0} grants, -${r.rows_removed || 0} permission rows (add/edit/delete/export)`);
  },
};
