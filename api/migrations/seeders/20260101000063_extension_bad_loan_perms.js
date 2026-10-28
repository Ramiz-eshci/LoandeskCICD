'use strict';

/**
 * Seeder: Extensions workflow + Bad loans permissions (client 30-09-2026).
 * Roles › Module Permissions › Portfolio:
 *
 *   PORTFOLIO.EXTENSION          view  Extensions menu + list + facility "Extension" tab
 *                                add   raise an extension request from a facility
 *                                edit  work the request: fees, send Extension Agreement,
 *                                      upload signed agreement / exit evidence, submit paper
 *   PORTFOLIO.HEAD_OF_EXTENSION  view  "Head of Extension" - same pattern as Head of Application:
 *                                      e-mailed the Extension Request paper on submit and may
 *                                      APPROVE / REJECT the extension.
 *   PORTFOLIO.FACILITY_BAD_DEBT  view  facility "Bad Debt" tab
 *                                add   mark as Bad Debt, update the bad-debt note, record money received
 *                                edit  Write Off (no hope) / restore a bad debt to Active
 *
 * First run only (no one loses what they had):
 *   EXTENSION view + edit   <- roles holding EXTENSION add
 *   FACILITY_BAD_DEBT view  <- roles holding FACILITY_AMENDMENTS view
 * Head of Extension and the bad-debt actions are granted to nobody: tick them in Roles.
 *
 * Also adds the document types the extension files are saved under.
 * Additive and idempotent.
 */

const SQL = `
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @first BIT = CASE WHEN EXISTS (SELECT 1 FROM modules WHERE module_code = 'PORTFOLIO.HEAD_OF_EXTENSION') THEN 0 ELSE 1 END;
DECLARE @extSort INT = COALESCE((SELECT TOP 1 sort_order FROM modules WHERE module_code = 'PORTFOLIO.EXTENSION'), 46);

-- 1) modules
IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'PORTFOLIO.EXTENSION')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES ('PORTFOLIO.EXTENSION', N'Extension', 'PORTFOLIO', 46);
IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'PORTFOLIO.HEAD_OF_EXTENSION')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES ('PORTFOLIO.HEAD_OF_EXTENSION', N'Head of Extension', 'PORTFOLIO', @extSort);
ELSE
  UPDATE modules SET module_name = N'Head of Extension', parent_code = 'PORTFOLIO' WHERE module_code = 'PORTFOLIO.HEAD_OF_EXTENSION';
IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'PORTFOLIO.FACILITY_BAD_DEBT')
  INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES ('PORTFOLIO.FACILITY_BAD_DEBT', N'Facility - Bad Debt / Write Off', 'PORTFOLIO', 218);

-- 2) permission rows
DECLARE @perms TABLE (module_key NVARCHAR(100), permission_key NVARCHAR(50), description NVARCHAR(300));
INSERT INTO @perms VALUES
  ('PORTFOLIO.EXTENSION', 'view', 'Extensions menu, extension list and the facility Extension tab'),
  ('PORTFOLIO.EXTENSION', 'add', 'Raise an extension request from a facility'),
  ('PORTFOLIO.EXTENSION', 'edit', 'Work an extension: fees, Extension Agreement, signed upload, submit to Head of Extension'),
  ('PORTFOLIO.HEAD_OF_EXTENSION', 'view', 'Head of Extension: receives the Extension Request paper and approves / rejects extensions'),
  ('PORTFOLIO.FACILITY_BAD_DEBT', 'view', 'Facility Bad Debt tab'),
  ('PORTFOLIO.FACILITY_BAD_DEBT', 'add', 'Mark as bad debt, update the bad-debt note, record money received'),
  ('PORTFOLIO.FACILITY_BAD_DEBT', 'edit', 'Write off (no hope) or restore a bad debt to active');
INSERT INTO permissions (module_key, permission_key, description)
SELECT p.module_key, p.permission_key, p.description FROM @perms p
 WHERE NOT EXISTS (SELECT 1 FROM permissions x WHERE x.module_key = p.module_key AND LOWER(x.permission_key) = p.permission_key);

-- 3) first run: carry access over
DECLARE @granted INT = 0;
IF @first = 1
BEGIN
  DECLARE @map TABLE (new_mod NVARCHAR(100), new_act NVARCHAR(50), old_mod NVARCHAR(100), old_act NVARCHAR(50));
  INSERT INTO @map VALUES
    ('PORTFOLIO.EXTENSION', 'view', 'PORTFOLIO.EXTENSION', 'add'),
    ('PORTFOLIO.EXTENSION', 'edit', 'PORTFOLIO.EXTENSION', 'add'),
    ('PORTFOLIO.FACILITY_BAD_DEBT', 'view', 'PORTFOLIO.FACILITY_AMENDMENTS', 'view');
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT DISTINCT rp.role_id, np.permission_id
    FROM @map m
    JOIN permissions op ON op.module_key = m.old_mod AND LOWER(op.permission_key) = m.old_act
    JOIN role_permissions rp ON rp.permission_id = op.permission_id
    JOIN permissions np ON np.module_key = m.new_mod AND LOWER(np.permission_key) = m.new_act
   WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.permission_id);
  SET @granted = @@ROWCOUNT;
END

-- 4) document types for extension files
DECLARE @dt TABLE (code NVARCHAR(50), name NVARCHAR(150));
INSERT INTO @dt VALUES
  ('EXTENSION_AGREEMENT', 'Extension Agreement'),
  ('EXTENSION_AGREEMENT_SIGNED', 'Extension Agreement (Signed)'),
  ('EXTENSION_REQUEST', 'Extension Request (Credit Paper)'),
  ('EXTENSION_EXIT_EVIDENCE', 'Extension Exit Evidence');
INSERT INTO document_types (code, name, category)
SELECT d.code, d.name, 'Portfolio' FROM @dt d
 WHERE NOT EXISTS (SELECT 1 FROM document_types x WHERE x.code = d.code);

COMMIT;
SELECT @first AS first_run, @granted AS granted;`;

module.exports = {
  async run(db) {
    const rows = await db.raw(SQL);
    const r = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
    if (r) console.log(`[seed] extension/bad-loan perms: first_run=${r.first_run} grants_copied=${r.granted}`);
  },
};
