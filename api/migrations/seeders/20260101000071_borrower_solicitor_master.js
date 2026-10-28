'use strict';

/**
 * Seeder: Borrower's Solicitor master permissions (client 15-10-2026).
 * Module MASTERS.BORROWER_SOLICITOR_MASTER ("Borrower's Solicitor") with view / add / edit /
 * delete - it shows in the Roles matrix and the Masters sidebar menu. First run only: each
 * action goes to the roles that already hold the same action on the Solicitor / Valuer
 * master, so nobody loses a screen they would expect. Idempotent.
 */
module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.BORROWER_SOLICITOR_MASTER')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.BORROWER_SOLICITOR_MASTER', N'Borrower''s Solicitor', 'MASTERS', 108);

DECLARE @acts TABLE (a NVARCHAR(20));
INSERT INTO @acts VALUES ('view'), ('add'), ('edit'), ('delete');

DECLARE @created TABLE (permission_id INT, a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.permission_key INTO @created (permission_id, a)
SELECT 'MASTERS.BORROWER_SOLICITOR_MASTER', x.a, x.a + ' MASTERS.BORROWER_SOLICITOR_MASTER' FROM @acts x
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = 'MASTERS.BORROWER_SOLICITOR_MASTER' AND LOWER(p.permission_key) = x.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.SOLICITOR_VALUER_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);
  },
};
