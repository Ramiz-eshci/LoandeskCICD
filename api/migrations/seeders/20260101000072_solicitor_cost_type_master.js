'use strict';

/**
 * Seeder (client 16-10-2026): Solicitor Cost Type master.
 *  - Module MASTERS.SOLICITOR_COST_TYPE_MASTER ("Solicitor Cost Types") with view / add /
 *    edit / delete - shows in the Roles matrix and the Masters sidebar. First run only: each
 *    action goes to the roles that already hold the same action on the Solicitor Check master.
 *  - A starter list of cost names (first run only - an emptied list is left empty).
 * The Solicitor Quote step's "Additional costs" picks from this list so costs can be
 * reported by type. Idempotent.
 */
module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.SOLICITOR_COST_TYPE_MASTER')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.SOLICITOR_COST_TYPE_MASTER', N'Solicitor Cost Types', 'MASTERS', 115);

DECLARE @acts TABLE (a NVARCHAR(20));
INSERT INTO @acts VALUES ('view'), ('add'), ('edit'), ('delete');

DECLARE @created TABLE (permission_id INT, a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.permission_key INTO @created (permission_id, a)
SELECT 'MASTERS.SOLICITOR_COST_TYPE_MASTER', x.a, x.a + ' MASTERS.SOLICITOR_COST_TYPE_MASTER' FROM @acts x
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = 'MASTERS.SOLICITOR_COST_TYPE_MASTER' AND LOWER(p.permission_key) = x.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.SOLICITOR_CHECK_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);

    const existing = await db.query('SELECT COUNT(*) AS n FROM solicitor_cost_types');
    if (existing[0] && existing[0].n > 0) return;
    const names = [
      'SDLT / LBTT handling', 'Bank transfer (CHAPS) fee', 'Search fees', 'Land Registry fee',
      'ID / AML check fee', 'Leasehold supplement', 'Company / guarantee supplement',
    ];
    let order = 0;
    for (const nm of names) {
      order += 1;
      await db.query(
        'INSERT INTO solicitor_cost_types (code, name, sort_order) VALUES (@p0, @p1, @p2)',
        ['SCT-' + String(order).padStart(4, '0'), nm, order]);
    }
  },
};
