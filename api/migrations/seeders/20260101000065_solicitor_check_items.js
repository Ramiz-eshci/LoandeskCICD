'use strict';

/**
 * Seeder (client 07-10-2026): Solicitor Check master.
 *  - Module MASTERS.SOLICITOR_CHECK_MASTER + view/add/edit/delete, granted to
 *    whoever holds the same action on Solicitor / Valuer (nearest master).
 *  - Default checks on the borrower's solicitor (first run only).
 * Idempotent.
 */
module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.SOLICITOR_CHECK_MASTER')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.SOLICITOR_CHECK_MASTER', N'Solicitor Checks', 'MASTERS', 114);

DECLARE @acts TABLE (a NVARCHAR(20));
INSERT INTO @acts VALUES ('view'), ('add'), ('edit'), ('delete');

DECLARE @created TABLE (permission_id INT, a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.permission_key INTO @created (permission_id, a)
SELECT 'MASTERS.SOLICITOR_CHECK_MASTER', x.a, x.a + ' MASTERS.SOLICITOR_CHECK_MASTER' FROM @acts x
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = 'MASTERS.SOLICITOR_CHECK_MASTER' AND LOWER(p.permission_key) = x.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.SOLICITOR_VALUER_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);

    const existing = await db.query('SELECT COUNT(*) AS n FROM solicitor_check_items WHERE flag_deleted = 0');
    if (existing[0] && existing[0].n > 0) return;
    const names = [
      'Google / firm and contact search complete', 'Regulator membership checked',
      'Two or more partners confirmed', 'PI cover requirement satisfied',
      'Solicitor fee quote received', 'Dual representation confirmed / N/A', 'Solicitor panel status confirmed',
    ];
    let order = 0;
    for (const nm of names) {
      order += 1;
      const code = 'SOL' + String(order).padStart(4, '0');
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM solicitor_check_items WHERE LOWER(name) = LOWER(@p0) AND flag_deleted = 0)
           INSERT INTO solicitor_check_items (code, name, sort_order) VALUES (@p1, @p0, @p2)`,
        [nm, code, order]);
    }
  },
};
