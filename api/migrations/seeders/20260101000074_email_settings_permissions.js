'use strict';

/**
 * Seeder: Email Settings + Email History masters (client 17-10-2026).
 *   MASTERS.EMAIL_SETTINGS  view / edit  - who is copied in, custom text, extra files
 *   MASTERS.EMAIL_HISTORY   view         - every e-mail sent, by module / reference / date
 * Both show in the Roles matrix and the Masters sidebar menu. First run only: granted to the
 * roles that already hold the same action on the Users master (admin roles). Super / company
 * admins bypass RBAC anyway. Idempotent.
 */
module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.EMAIL_SETTINGS')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.EMAIL_SETTINGS', N'Email Settings', 'MASTERS', 120);
IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.EMAIL_HISTORY')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.EMAIL_HISTORY', N'Email History', 'MASTERS', 121);

DECLARE @want TABLE (m NVARCHAR(100), a NVARCHAR(20));
INSERT INTO @want VALUES ('MASTERS.EMAIL_SETTINGS', 'view'), ('MASTERS.EMAIL_SETTINGS', 'edit'), ('MASTERS.EMAIL_HISTORY', 'view');

DECLARE @created TABLE (permission_id INT, m NVARCHAR(100), a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.module_key, inserted.permission_key INTO @created (permission_id, m, a)
SELECT w.m, w.a, w.a + ' ' + w.m FROM @want w
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = w.m AND LOWER(p.permission_key) = w.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.USER_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);
  },
};
