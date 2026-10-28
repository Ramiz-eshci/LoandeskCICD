'use strict';

/**
 * Seeder: Underwriting "Accept Case" = UNDERWRITING.CASE > APPROVE (was ADD, originally "accept").
 * Also: step 1 Initial Review and the application-side "Accept / Send to Underwriting"
 * underwriter path now check approve. Return to BDM stays on ADD.
 *
 * First run only (marker = the approve row's description): every role that held
 * UNDERWRITING.CASE accept before the merge (bak_pm_* backup tables, or a
 * still-present accept row) gets UNDERWRITING.CASE approve, so nobody loses Accept Case.
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
          WHERE bp.module_key = 'UNDERWRITING.CASE' AND LOWER(bp.permission_key) = 'accept'
            AND EXISTS (SELECT 1 FROM roles r WHERE r.role_id = b.role_id)
            AND NOT EXISTS (SELECT 1 FROM @roles x WHERE x.role_id = b.role_id);`
      : '';
    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @MARK NVARCHAR(255) = N'approve UNDERWRITING.CASE (Accept Case, decide)';

IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'UNDERWRITING.CASE' AND LOWER(permission_key) = 'approve')
  INSERT INTO permissions (module_key, permission_key, description) VALUES ('UNDERWRITING.CASE', 'approve', 'approve UNDERWRITING.CASE');
DECLARE @appr INT = (SELECT permission_id FROM permissions WHERE module_key = 'UNDERWRITING.CASE' AND LOWER(permission_key) = 'approve');
DECLARE @granted INT = 0;

IF NOT EXISTS (SELECT 1 FROM permissions WHERE permission_id = @appr AND description = @MARK)
BEGIN
  DECLARE @roles TABLE (role_id INT PRIMARY KEY);
  INSERT INTO @roles (role_id)
  SELECT DISTINCT rp.role_id FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
   WHERE p.module_key = 'UNDERWRITING.CASE' AND LOWER(p.permission_key) = 'accept';
  ${fromBackup}
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.role_id, @appr FROM @roles r
   WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.role_id AND x.permission_id = @appr);
  SET @granted = @@ROWCOUNT;
  UPDATE permissions SET description = @MARK WHERE permission_id = @appr;
END

COMMIT;
SELECT @granted AS granted;`);
    // eslint-disable-next-line no-console
    console.log(`    underwriting accept -> approve: +${(rows[0] || {}).granted || 0} approve grants`);
  },
};
