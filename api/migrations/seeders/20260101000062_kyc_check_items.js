'use strict';

/**
 * Seeder (client 07-10-2026): KYC Check master.
 *  - Module MASTERS.KYC_CHECK_MASTER + view/add/edit/delete permissions, granted
 *    to whoever holds the same action on KYC Team (nearest existing master).
 *  - Default check lists for Individual and Company (first run only).
 * Idempotent.
 */
module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.KYC_CHECK_MASTER')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.KYC_CHECK_MASTER', N'KYC Checks', 'MASTERS', 113);

DECLARE @acts TABLE (a NVARCHAR(20));
INSERT INTO @acts VALUES ('view'), ('add'), ('edit'), ('delete');

DECLARE @created TABLE (permission_id INT, a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.permission_key INTO @created (permission_id, a)
SELECT 'MASTERS.KYC_CHECK_MASTER', x.a, x.a + ' MASTERS.KYC_CHECK_MASTER' FROM @acts x
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = 'MASTERS.KYC_CHECK_MASTER' AND LOWER(p.permission_key) = x.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.KYC_TEAM_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);

    const existing = await db.query('SELECT COUNT(*) AS n FROM kyc_check_items WHERE flag_deleted = 0');
    if (existing[0] && existing[0].n > 0) return;
    const types = await db.query("SELECT applicant_type_id AS id, name FROM applicant_types WHERE name IN ('Individual','Company')");
    const idOf = (nm) => { const r = types.find((t) => t.name === nm); return r ? r.id : null; };
    const groups = [
      ['Individual', ['Valid ID checked', 'Proof of address checked', 'AML / Sanctions screening', 'PEP check', 'Credit report (30 days)', 'Adverse media search']],
      ['Company', ['Companies House search', 'Insolvency search', 'Gazette search', 'Director Google search', 'AML / Sanctions screening', 'PEP check', 'Credit report (30 days)', 'Adverse media search']],
    ];
    let seq = 0;
    for (const [tname, names] of groups) {
      const tid = idOf(tname);
      let order = 0;
      for (const nm of names) {
        seq += 1; order += 1;
        const code = 'KYC' + String(seq).padStart(4, '0');
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM kyc_check_items WHERE applicant_type_id = @p0 AND LOWER(name) = LOWER(@p1) AND flag_deleted = 0)
             INSERT INTO kyc_check_items (code, applicant_type_id, name, sort_order) VALUES (@p2, @p0, @p1, @p3)`,
          [tid, nm, code, order]);
      }
    }
  },
};
