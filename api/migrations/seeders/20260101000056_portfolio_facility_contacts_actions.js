'use strict';

/**
 * Seeder: Facility - Contacts gets EDIT and DELETE.
 *
 * Customer logs moved from the Portfolio list ("Customer Logs" tab) into the
 * facility Contacts tab. Facility - Contacts now covers:
 *   view   contact schedule, customer logs, notes
 *   add    Add Log / log a milestone contact / Add Note
 *   edit   edit a customer log (incl. from the Contact Schedule row)
 *   delete delete a customer log
 *
 * First run only: roles that had Customer Logs (PORTFOLIO.CONTACT_LOG) edit/delete
 * get the matching Facility - Contacts action, so nobody loses access. Idempotent.
 */
module.exports = {
  async run(db) {
    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @first BIT = CASE WHEN EXISTS (SELECT 1 FROM permissions WHERE module_key = 'PORTFOLIO.FACILITY_CONTACTS' AND LOWER(permission_key) = 'edit') THEN 0 ELSE 1 END;

DECLARE @perms TABLE (permission_key NVARCHAR(50));
INSERT INTO @perms VALUES ('edit'), ('delete');
INSERT INTO permissions (module_key, permission_key, description)
SELECT 'PORTFOLIO.FACILITY_CONTACTS', p.permission_key, p.permission_key + ' PORTFOLIO.FACILITY_CONTACTS' FROM @perms p
 WHERE NOT EXISTS (SELECT 1 FROM permissions x WHERE x.module_key = 'PORTFOLIO.FACILITY_CONTACTS' AND LOWER(x.permission_key) = p.permission_key);

DECLARE @granted INT = 0;
IF @first = 1
BEGIN
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT DISTINCT rp.role_id, np.permission_id
    FROM permissions op
    JOIN role_permissions rp ON rp.permission_id = op.permission_id
    JOIN permissions np ON np.module_key = 'PORTFOLIO.FACILITY_CONTACTS' AND LOWER(np.permission_key) = LOWER(op.permission_key)
   WHERE op.module_key = 'PORTFOLIO.CONTACT_LOG' AND LOWER(op.permission_key) IN ('edit', 'delete')
     AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.permission_id);
  SET @granted = @@ROWCOUNT;
END
COMMIT;
SELECT @granted AS granted;`);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    facility contacts edit/delete: +${r.granted || 0} grants copied from Customer Logs`);
  },
};
