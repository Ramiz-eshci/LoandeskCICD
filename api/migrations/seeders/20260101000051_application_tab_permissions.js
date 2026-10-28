'use strict';

/**
 * Seeder: Application detail tabs are permission-driven + Submit to Underwriting = APPROVE.
 *
 * Tab -> module (VIEW shows the tab):
 *   Summary          APPLICATIONS.APPLICATION_LIST      (existing)
 *   Applicant        APPLICATIONS.APPLICANT_DETAILS     (existing)  edit = Edit button
 *   Loan Details     APPLICATIONS.LOAN_DETAILS          (existing)  edit = Edit button
 *   Security         APPLICATIONS.SECURITY_PROPERTY     (existing)  edit = Edit button
 *   Broker           APPLICATIONS.BROKER                NEW  view
 *   Documents        APPLICATIONS.DOCUMENTS             (existing)  add = Upload, edit = Edit/Delete
 *   Tasks            APPLICATIONS.TASKS                 NEW  view | add (Add Task) | edit (Complete/Reopen)
 *   Communications   APPLICATIONS.COMMUNICATIONS        NEW  view | add (Log Communication)
 *   Audit            APPLICATIONS.AUDIT                 NEW  view
 *   Enquiry Details  APPLICATIONS.ENQUIRY_DETAILS       NEW  view
 *
 * First run only (keeps today's access, so nothing disappears by surprise):
 *   - new VIEW rows      -> every role with APPLICATION_LIST view (they saw every tab)
 *   - TASKS add/edit, COMMUNICATIONS add -> roles with applicant/loan/security edit
 *     (the old rule for tasks / communications)
 *   - DOCUMENTS add      -> roles with DOCUMENTS edit (edit used to allow upload)
 *
 * Submit to Underwriting: the Accept / Send to Underwriting button is now APPROVE.
 *   roles with its add (or old submit) get approve; view / add / edit / submit rows removed.
 *
 * Runs after 049 / 050. Idempotent.
 */

module.exports = {
  async run(db) {
    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @first BIT = CASE WHEN EXISTS (SELECT 1 FROM modules WHERE module_code = 'APPLICATIONS.TASKS') THEN 0 ELSE 1 END;

-- 1) modules + tab order
DECLARE @mods TABLE (code NVARCHAR(100), name NVARCHAR(150), sort INT);
INSERT INTO @mods VALUES
  ('APPLICATIONS.ALL_APPLICATIONS',     N'All Applications',       23),
  ('APPLICATIONS.APPLICATION_LIST',     N'Application List',       24),
  ('APPLICATIONS.APPLICANT_DETAILS',    N'Applicant Details',      25),
  ('APPLICATIONS.LOAN_DETAILS',         N'Loan Details',           26),
  ('APPLICATIONS.SECURITY_PROPERTY',    N'Security / Property',    27),
  ('APPLICATIONS.BROKER',               N'Broker',                 28),
  ('APPLICATIONS.DOCUMENTS',            N'Documents',              29),
  ('APPLICATIONS.TASKS',                N'Tasks',                  30),
  ('APPLICATIONS.COMMUNICATIONS',       N'Communications',         31),
  ('APPLICATIONS.AUDIT',                N'Audit',                  32),
  ('APPLICATIONS.ENQUIRY_DETAILS',      N'Enquiry Details',        33),
  ('APPLICATIONS.APPLICATION_READINESS',N'Application Readiness',  34),
  ('APPLICATIONS.SUBMIT_TO_UNDERWRITING',N'Submit to Underwriting',35);
INSERT INTO modules (module_code, module_name, parent_code, sort_order)
SELECT m.code, m.name, 'APPLICATIONS', m.sort FROM @mods m
 WHERE NOT EXISTS (SELECT 1 FROM modules x WHERE x.module_code = m.code);
UPDATE x SET sort_order = m.sort FROM modules x JOIN @mods m ON m.code = x.module_code;

-- 2) permission rows for the new tab modules
DECLARE @perms TABLE (module_key NVARCHAR(100), permission_key NVARCHAR(50), grant_from NVARCHAR(10));
INSERT INTO @perms VALUES
  ('APPLICATIONS.BROKER','view','list'),
  ('APPLICATIONS.TASKS','view','list'), ('APPLICATIONS.TASKS','add','case'), ('APPLICATIONS.TASKS','edit','case'),
  ('APPLICATIONS.COMMUNICATIONS','view','list'), ('APPLICATIONS.COMMUNICATIONS','add','case'),
  ('APPLICATIONS.AUDIT','view','list'),
  ('APPLICATIONS.ENQUIRY_DETAILS','view','list');

DECLARE @created TABLE (permission_id INT, grant_from NVARCHAR(10));
INSERT INTO permissions (module_key, permission_key, description)
OUTPUT inserted.permission_id, NULL INTO @created (permission_id, grant_from)
SELECT p.module_key, p.permission_key, p.permission_key + ' ' + p.module_key FROM @perms p
 WHERE NOT EXISTS (SELECT 1 FROM permissions x WHERE x.module_key = p.module_key AND LOWER(x.permission_key) = p.permission_key);
UPDATE c SET grant_from = p.grant_from
  FROM @created c JOIN permissions x ON x.permission_id = c.permission_id
  JOIN @perms p ON p.module_key = x.module_key AND p.permission_key = LOWER(x.permission_key);

-- roles that could see every tab / work the case before this change
DECLARE @listRoles TABLE (role_id INT PRIMARY KEY);
INSERT INTO @listRoles SELECT DISTINCT rp.role_id FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'APPLICATIONS.APPLICATION_LIST' AND LOWER(p.permission_key) = 'view';
DECLARE @caseRoles TABLE (role_id INT PRIMARY KEY);
INSERT INTO @caseRoles SELECT DISTINCT rp.role_id FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key IN ('APPLICATIONS.APPLICANT_DETAILS','APPLICATIONS.LOAN_DETAILS','APPLICATIONS.SECURITY_PROPERTY')
   AND LOWER(p.permission_key) = 'edit';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, c.permission_id FROM @created c JOIN @listRoles r ON c.grant_from = 'list'
UNION
SELECT r.role_id, c.permission_id FROM @created c JOIN @caseRoles r ON c.grant_from = 'case';
DECLARE @tabGrants INT = @@ROWCOUNT;

-- 3) Documents: edit used to allow upload -> give add (first run only)
DECLARE @docGrants INT = 0;
IF @first = 1
BEGIN
  DECLARE @docAdd INT = (SELECT permission_id FROM permissions WHERE module_key = 'APPLICATIONS.DOCUMENTS' AND LOWER(permission_key) = 'add');
  IF @docAdd IS NOT NULL
  BEGIN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT DISTINCT rp.role_id, @docAdd FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE p.module_key = 'APPLICATIONS.DOCUMENTS' AND LOWER(p.permission_key) = 'edit'
       AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = @docAdd);
    SET @docGrants = @@ROWCOUNT;
  END
END

-- 4) Submit to Underwriting -> approve only
IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'APPLICATIONS.SUBMIT_TO_UNDERWRITING' AND LOWER(permission_key) = 'approve')
  INSERT INTO permissions (module_key, permission_key, description)
  VALUES ('APPLICATIONS.SUBMIT_TO_UNDERWRITING', 'approve', 'approve APPLICATIONS.SUBMIT_TO_UNDERWRITING');
DECLARE @appr INT = (SELECT permission_id FROM permissions WHERE module_key = 'APPLICATIONS.SUBMIT_TO_UNDERWRITING' AND LOWER(permission_key) = 'approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, @appr FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'APPLICATIONS.SUBMIT_TO_UNDERWRITING' AND LOWER(p.permission_key) IN ('add','submit')
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = @appr);
DECLARE @apprGrants INT = @@ROWCOUNT;
DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'APPLICATIONS.SUBMIT_TO_UNDERWRITING' AND LOWER(p.permission_key) IN ('view','add','edit','submit');
DELETE FROM permissions
 WHERE module_key = 'APPLICATIONS.SUBMIT_TO_UNDERWRITING' AND LOWER(permission_key) IN ('view','add','edit','submit');
DECLARE @removed INT = @@ROWCOUNT;

COMMIT;
SELECT (SELECT COUNT(*) FROM @created) AS new_perms, @tabGrants AS tab_grants, @docGrants AS doc_grants,
       @apprGrants AS approve_grants, @removed AS submit_rows_removed;`);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    application tabs: +${r.new_perms} permission rows, +${r.tab_grants} tab grants, +${r.doc_grants} document add grants; submit-to-underwriting: +${r.approve_grants} approve grants, -${r.submit_rows_removed} old rows`);
  },
};
