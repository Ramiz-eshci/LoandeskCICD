'use strict';

/**
 * Seeder: "Convert to Application" (enquiry detail) = ENQUIRIES.SUBMIT_TO_APPLICATION > ADD.
 * The Edit checkbox on "Submit to Application" is removed.
 *
 *   1) make sure the (SUBMIT_TO_APPLICATION, add) permission row exists
 *   2) grant it to every role that could convert before:
 *        - roles holding SUBMIT_TO_APPLICATION edit now, and
 *        - roles that held ENQUIRY_LIST convert or SUBMIT_TO_APPLICATION edit
 *          in the pre-merge backup (bak_pm_* tables, when present)
 *   3) delete the SUBMIT_TO_APPLICATION edit grants + permission row
 *
 * Runs after 049. Idempotent.
 */

module.exports = {
  async run(db) {
    const bak = await db.query(
      `SELECT CASE WHEN OBJECT_ID('dbo.bak_pm_permissions','U') IS NOT NULL
                    AND OBJECT_ID('dbo.bak_pm_role_permissions','U') IS NOT NULL THEN 1 ELSE 0 END AS ok`,
    );
    const fromBackup = bak[0] && bak[0].ok
      ? `INSERT INTO @roles (role_id)
         SELECT DISTINCT b.role_id FROM dbo.bak_pm_role_permissions b
           JOIN dbo.bak_pm_permissions bp ON bp.permission_id = b.permission_id
          WHERE ((bp.module_key = 'ENQUIRIES.ENQUIRY_LIST' AND LOWER(bp.permission_key) = 'convert')
              OR (bp.module_key = 'ENQUIRIES.SUBMIT_TO_APPLICATION' AND LOWER(bp.permission_key) = 'edit'))
            AND EXISTS (SELECT 1 FROM roles r WHERE r.role_id = b.role_id)
            AND NOT EXISTS (SELECT 1 FROM @roles x WHERE x.role_id = b.role_id);`
      : '';

    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'ENQUIRIES.SUBMIT_TO_APPLICATION' AND LOWER(permission_key) = 'add')
  INSERT INTO permissions (module_key, permission_key, description)
  VALUES ('ENQUIRIES.SUBMIT_TO_APPLICATION', 'add', 'add ENQUIRIES.SUBMIT_TO_APPLICATION');
DECLARE @add INT = (SELECT permission_id FROM permissions
                     WHERE module_key = 'ENQUIRIES.SUBMIT_TO_APPLICATION' AND LOWER(permission_key) = 'add');

DECLARE @roles TABLE (role_id INT PRIMARY KEY);
INSERT INTO @roles (role_id)
SELECT DISTINCT rp.role_id FROM role_permissions rp
  JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'ENQUIRIES.SUBMIT_TO_APPLICATION' AND LOWER(p.permission_key) = 'edit';
${fromBackup}

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, @add FROM @roles r
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.role_id AND x.permission_id = @add);
DECLARE @granted INT = @@ROWCOUNT;

DELETE rp FROM role_permissions rp
  JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'ENQUIRIES.SUBMIT_TO_APPLICATION' AND LOWER(p.permission_key) = 'edit';
DELETE FROM permissions WHERE module_key = 'ENQUIRIES.SUBMIT_TO_APPLICATION' AND LOWER(permission_key) = 'edit';
DECLARE @removed INT = @@ROWCOUNT;

COMMIT;
SELECT @granted AS granted, @removed AS removed;`);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    submit-to-application: +${r.granted || 0} add grants, edit row removed: ${r.removed ? 'yes' : 'no (already gone)'}`);
  },
};
