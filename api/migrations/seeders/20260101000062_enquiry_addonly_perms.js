'use strict';

/**
 * Seeder: Enquiries matrix - "Request Info" and "Send Indicative & Offer" are ADD only
 * (client 30-09-2026). On the Roles screen these two rows now show a single Add
 * checkbox; View / Edit / Delete / Reject / Accept are removed.
 *
 * Modules: ENQUIRIES.REQUEST_INFO, ENQUIRIES.OFFER.
 *
 *   1) make sure the (module, add) permission row exists for both
 *   2) carry access over so nobody loses what they had - both the Request Info tool
 *      and the Indicatives/Offer tools were gated on ADD *or* EDIT, and "Mark
 *      Accepted" on an offer was gated on OFFER add (was .accept). So every role
 *      holding EDIT on either module, or ACCEPT on OFFER, is granted that module's ADD.
 *   3) delete every non-add permission row (+ its grants) on the two modules.
 *
 * Runs after 061. Idempotent. Also invoked from migration
 * 20260101000047_enquiry_addonly_perms so a plain `npm run migrate` applies it.
 */

const SQL = `
SET XACT_ABORT ON;
BEGIN TRAN;

-- 1) ensure the add rows exist
IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'ENQUIRIES.REQUEST_INFO' AND LOWER(permission_key) = 'add')
  INSERT INTO permissions (module_key, permission_key, description)
  VALUES ('ENQUIRIES.REQUEST_INFO', 'add', 'add ENQUIRIES.REQUEST_INFO');
IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'ENQUIRIES.OFFER' AND LOWER(permission_key) = 'add')
  INSERT INTO permissions (module_key, permission_key, description)
  VALUES ('ENQUIRIES.OFFER', 'add', 'add ENQUIRIES.OFFER');

DECLARE @riAdd INT = (SELECT permission_id FROM permissions WHERE module_key = 'ENQUIRIES.REQUEST_INFO' AND LOWER(permission_key) = 'add');
DECLARE @ofAdd INT = (SELECT permission_id FROM permissions WHERE module_key = 'ENQUIRIES.OFFER'        AND LOWER(permission_key) = 'add');

-- 2) carry access over, per module
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, @riAdd FROM role_permissions rp
  JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'ENQUIRIES.REQUEST_INFO' AND LOWER(p.permission_key) = 'edit'
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = @riAdd);
DECLARE @riGrants INT = @@ROWCOUNT;

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, @ofAdd FROM role_permissions rp
  JOIN permissions p ON p.permission_id = rp.permission_id
 WHERE p.module_key = 'ENQUIRIES.OFFER' AND LOWER(p.permission_key) IN ('edit', 'accept')
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = @ofAdd);
DECLARE @ofGrants INT = @@ROWCOUNT;

-- 3) remove every non-add row (+ grants) on the two modules
DECLARE @del TABLE (permission_id INT PRIMARY KEY);
INSERT INTO @del
SELECT permission_id FROM permissions
 WHERE module_key IN ('ENQUIRIES.REQUEST_INFO', 'ENQUIRIES.OFFER') AND LOWER(permission_key) <> 'add';
DELETE rp FROM role_permissions rp JOIN @del d ON d.permission_id = rp.permission_id;
DECLARE @delGrants INT = @@ROWCOUNT;
DELETE p FROM permissions p JOIN @del d ON d.permission_id = p.permission_id;
DECLARE @delRows INT = @@ROWCOUNT;

COMMIT;
SELECT @riGrants AS ri_grants, @ofGrants AS of_grants, @delGrants AS del_grants, @delRows AS del_rows;`;

module.exports = {
  async run(db) {
    const rows = await db.raw(SQL);
    const r = (rows && rows[0]) || {};
    // eslint-disable-next-line no-console
    console.log(`    enquiry add-only: +${r.ri_grants || 0} Request Info add / +${r.of_grants || 0} Send Indicative & Offer add grants carried over; `
      + `removed -${r.del_grants || 0} grants / -${r.del_rows || 0} permission rows`);
  },
};
