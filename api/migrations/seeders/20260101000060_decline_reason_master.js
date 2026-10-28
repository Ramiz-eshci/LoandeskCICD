'use strict';

/**
 * Seeder: Decline Reason master (client 29-09-2026).
 *
 *  1. Module MASTERS.DECLINE_REASON_MASTER ("Decline Reason") with
 *     view / add / edit / delete. First run only: each action goes to the roles
 *     that already hold the same action on Rejection Reason, so nobody loses
 *     a screen they would expect.
 *  2. The reasons the enquiry Decline popup offers. Codes follow the master's
 *     auto-code format (DCR-0001 ...). Idempotent: guarded by name.
 */
const REASONS = [
  'Asset Type', 'Over Leverage', 'Loan Size', 'Geography', 'Deferred Deposit',
  'Underlying Asset Value', 'Development', 'Credit Profile', 'Multi Re-Bridge',
  'Regulated', 'Charge Structure',
];

module.exports = {
  async run(db) {
    await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'MASTERS.DECLINE_REASON_MASTER')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order)
  VALUES ('MASTERS.DECLINE_REASON_MASTER', N'Decline Reason', 'MASTERS', 107);

DECLARE @acts TABLE (a NVARCHAR(20));
INSERT INTO @acts VALUES ('view'), ('add'), ('edit'), ('delete');

DECLARE @created TABLE (permission_id INT, a NVARCHAR(20));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, inserted.permission_key INTO @created (permission_id, a)
SELECT 'MASTERS.DECLINE_REASON_MASTER', x.a, x.a + ' MASTERS.DECLINE_REASON_MASTER' FROM @acts x
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module_key = 'MASTERS.DECLINE_REASON_MASTER' AND LOWER(p.permission_key) = x.a);

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, c.permission_id
  FROM @created c
  JOIN permissions sp ON sp.module_key = 'MASTERS.REJECTION_REASON_MASTER' AND LOWER(sp.permission_key) = LOWER(c.a)
  JOIN role_permissions rp ON rp.permission_id = sp.permission_id
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions z WHERE z.role_id = rp.role_id AND z.permission_id = c.permission_id);

COMMIT;`);

    for (let i = 0; i < REASONS.length; i++) {
      const name = REASONS[i];
      // Next free DCR-#### number (the master UI generates codes the same way).
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM decline_reasons WHERE name = @p0 AND flag_deleted = 0)
         BEGIN
           DECLARE @n INT = (SELECT ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(code, 5, 20))), 0) FROM decline_reasons WHERE code LIKE 'DCR-%');
           INSERT INTO decline_reasons (code, name, sort_order)
           VALUES ('DCR-' + RIGHT('0000' + CAST(@n + 1 AS NVARCHAR(10)), 4), @p0, @p1);
         END`,
        [name, i + 1],
      );
    }
  },
};
