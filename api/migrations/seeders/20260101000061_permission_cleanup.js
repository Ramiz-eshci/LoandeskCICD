'use strict';

/**
 * Seeder: Roles matrix clean-up (client 29-09-2026).
 *
 *  1) Enquiries › "Offer" is renamed "Send Indicative & Offer" (module ENQUIRIES.OFFER;
 *     code unchanged, it gates both Send Indicatives and Send Offer).
 *  2) Enquiries order: All Enquiries first, then Enquiry List, then the rest
 *     (sort_order is only compared between siblings, so 1 / 2 puts them on top).
 *  3) Notifications: View only. Every other action (add / edit / delete / approve /
 *     reject / export / configure ...) on any *NOTIFICATION* module is removed.
 *  4) Applications: the per-tab screens are gone from the matrix —
 *       Applicant Details, Loan Details, Security / Property, Broker, Documents,
 *       Tasks, Communications, Audit, Enquiry Details, Application Readiness.
 *     Everything on the application is now driven by Application List (and the
 *     All Applications scope):
 *       view   -> open the application and every tab
 *       add    -> create an application
 *       edit   -> edit applicant / loan / security, notes, upload + edit documents
 *       delete -> delete documents
 *     First run only (marker: APPLICATION_LIST.delete does not exist yet), access is
 *     carried over so nobody loses what they had:
 *       any tab edit / documents add|edit / tasks add|edit / communications add -> LIST edit
 *       documents edit (it allowed delete)                                    -> LIST delete
 *     Tasks + Communications tabs are removed from the application screen.
 *  5) Valuations, Credit, Legal & Completion: their permission rows are removed and
 *     the modules hidden (sidebar items are removed in the Angular nav).
 *
 * Grants + permission rows are deleted; module rows are soft-deleted (flag_deleted = 1)
 * so older seeders that upsert them do not create them again.
 * Runs last in `npm run seed` (and from migration 20260101000046_permission_cleanup),
 * so it re-applies after the older seeders on every run. Idempotent.
 */

const SQL = `
SET XACT_ABORT ON;
BEGIN TRAN;

-- 1) + 2) Enquiries
UPDATE modules SET module_name = N'Send Indicative & Offer' WHERE module_code = 'ENQUIRIES.OFFER';
UPDATE modules SET sort_order = 1 WHERE module_code = 'ENQUIRIES.ALL_ENQUIRIES';
UPDATE modules SET sort_order = 2 WHERE module_code = 'ENQUIRIES.ENQUIRY_LIST';

-- 3) Notifications: view only
DECLARE @notif TABLE (permission_id INT PRIMARY KEY);
INSERT INTO @notif SELECT permission_id FROM permissions
 WHERE UPPER(module_key) LIKE '%NOTIFICATION%' AND LOWER(permission_key) <> 'view';
DELETE rp FROM role_permissions rp JOIN @notif n ON n.permission_id = rp.permission_id;
DECLARE @notifGrants INT = @@ROWCOUNT;
DELETE p FROM permissions p JOIN @notif n ON n.permission_id = p.permission_id;
DECLARE @notifRows INT = @@ROWCOUNT;

-- 4) Applications
DECLARE @first BIT = CASE WHEN EXISTS (SELECT 1 FROM permissions
  WHERE module_key = 'APPLICATIONS.APPLICATION_LIST' AND LOWER(permission_key) = 'delete') THEN 0 ELSE 1 END;

IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'APPLICATIONS.APPLICATION_LIST' AND LOWER(permission_key) = 'edit')
  INSERT INTO permissions (module_key, permission_key, description)
  VALUES ('APPLICATIONS.APPLICATION_LIST', 'edit', 'edit APPLICATIONS.APPLICATION_LIST');
IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'APPLICATIONS.APPLICATION_LIST' AND LOWER(permission_key) = 'delete')
  INSERT INTO permissions (module_key, permission_key, description)
  VALUES ('APPLICATIONS.APPLICATION_LIST', 'delete', 'delete APPLICATIONS.APPLICATION_LIST');
DECLARE @listEdit INT = (SELECT permission_id FROM permissions WHERE module_key = 'APPLICATIONS.APPLICATION_LIST' AND LOWER(permission_key) = 'edit');
DECLARE @listDel  INT = (SELECT permission_id FROM permissions WHERE module_key = 'APPLICATIONS.APPLICATION_LIST' AND LOWER(permission_key) = 'delete');

DECLARE @carried INT = 0;
IF @first = 1
BEGIN
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT DISTINCT rp.role_id, @listEdit FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
   WHERE ((p.module_key IN ('APPLICATIONS.APPLICANT_DETAILS','APPLICATIONS.LOAN_DETAILS','APPLICATIONS.SECURITY_PROPERTY') AND LOWER(p.permission_key) = 'edit')
       OR (p.module_key = 'APPLICATIONS.DOCUMENTS' AND LOWER(p.permission_key) IN ('add','edit'))
       OR (p.module_key = 'APPLICATIONS.TASKS' AND LOWER(p.permission_key) IN ('add','edit'))
       OR (p.module_key = 'APPLICATIONS.COMMUNICATIONS' AND LOWER(p.permission_key) = 'add'))
     AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = @listEdit);
  SET @carried = @@ROWCOUNT;
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT DISTINCT rp.role_id, @listDel FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
   WHERE p.module_key = 'APPLICATIONS.DOCUMENTS' AND LOWER(p.permission_key) = 'edit'
     AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = @listDel);
  SET @carried = @carried + @@ROWCOUNT;
END

-- 4) + 5) modules that leave the matrix
DECLARE @gone TABLE (code NVARCHAR(100) PRIMARY KEY);
INSERT INTO @gone VALUES
  ('APPLICATIONS.APPLICANT_DETAILS'), ('APPLICATIONS.LOAN_DETAILS'), ('APPLICATIONS.SECURITY_PROPERTY'),
  ('APPLICATIONS.BROKER'), ('APPLICATIONS.DOCUMENTS'), ('APPLICATIONS.TASKS'), ('APPLICATIONS.COMMUNICATIONS'),
  ('APPLICATIONS.AUDIT'), ('APPLICATIONS.ENQUIRY_DETAILS'), ('APPLICATIONS.APPLICATION_READINESS'),
  ('VALUATION'), ('CREDIT'), ('LEGAL');
DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
  JOIN @gone g ON g.code = p.module_key;
DECLARE @goneGrants INT = @@ROWCOUNT;
DELETE p FROM permissions p JOIN @gone g ON g.code = p.module_key;
DECLARE @goneRows INT = @@ROWCOUNT;
UPDATE m SET flag_deleted = 1 FROM modules m JOIN @gone g ON g.code = m.module_code;

COMMIT;
SELECT @notifGrants AS notif_grants, @notifRows AS notif_rows, @carried AS carried,
       @goneGrants AS gone_grants, @goneRows AS gone_rows;`;

module.exports = {
  async run(db) {
    const rows = await db.raw(SQL);
    const r = (rows && rows[0]) || {};
    // eslint-disable-next-line no-console
    console.log(`    permission clean-up: notifications -${r.notif_grants || 0} grants / -${r.notif_rows || 0} rows; `
      + `applications +${r.carried || 0} Application List grants carried over; `
      + `removed screens -${r.gone_grants || 0} grants / -${r.gone_rows || 0} rows`);
  },
};
