'use strict';

/**
 * Seeder: KYC Team master permissions (client 28-09-2026).
 *
 * Adds module MASTERS.KYC_TEAM_MASTER ("KYC Team") under MASTERS with
 * view / add / edit / delete rows, so Roles > Add/Edit shows a KYC Team row and
 * the master CRUD is permission-driven like every other master.
 *
 * First run only: each action is granted to the roles that already hold the same
 * action on Solicitor / Valuer (the nearest existing master), so nobody loses a
 * screen they would expect. Idempotent.
 */
module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.KYC_TEAM_MASTER')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.KYC_TEAM_MASTER', N'KYC Team', 'MASTERS', 112);

DECLARE @acts TABLE (a NVARCHAR(20));
INSERT INTO @acts VALUES ('view'), ('add'), ('edit'), ('delete');

DECLARE @created TABLE (permission_id INT, a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.permission_key INTO @created (permission_id, a)
SELECT 'MASTERS.KYC_TEAM_MASTER', x.a, x.a + ' MASTERS.KYC_TEAM_MASTER' FROM @acts x
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = 'MASTERS.KYC_TEAM_MASTER' AND LOWER(p.permission_key) = x.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.SOLICITOR_VALUER_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);
  },
};
