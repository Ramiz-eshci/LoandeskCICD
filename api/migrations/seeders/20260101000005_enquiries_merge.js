'use strict';

/**
 * Seeder: ENQUIRIES matrix consolidation (merge redundant action-rows).
 *
 * The enquiry module previously listed six ACTION rows as separate screens:
 *   Add Enquiry, View/Edit Enquiry, Decline Enquiry, Request Initial
 *   Information, Initial Offer Status, Convert to Application.
 * These are actions on the single "Enquiry List" screen, not screens of their
 * own, and duplicated what the action columns already express. They are now
 * folded into ENQUIRIES.ENQUIRY_LIST action grants (see loandesk_matrix.json):
 *   Add Enquiry -> add . View/Edit -> view/edit . Decline -> reject .
 *   Request Initial Information -> submit . Initial Offer Status -> approve .
 *   Convert to Application -> convert.
 *
 * The consolidated ENQUIRY_LIST grants are seeded (additively) by the earlier
 * 20260101000004_modules_matrix seeder from the edited sheet, which runs before
 * this one. This seeder only REMOVES the now-stale rows from databases that were
 * seeded before the merge. On a fresh database there is nothing to remove and
 * every statement is a no-op.
 *
 * Idempotent: deletes are naturally repeatable; safe to run any number of times.
 */

const STALE = [
  'ENQUIRIES.ADD_ENQUIRY',
  'ENQUIRIES.VIEW_EDIT_ENQUIRY',
  'ENQUIRIES.DECLINE_ENQUIRY',
  'ENQUIRIES.REQUEST_INITIAL_INFORMATION',
  'ENQUIRIES.INITIAL_OFFER_STATUS',
  'ENQUIRIES.CONVERT_TO_APPLICATION',
];

module.exports = {
  async run(db) {
    const list = STALE.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

    // 1) role_permissions -> permissions (FK) -> permissions rows for stale modules.
    await db.raw(`
      DELETE rp FROM dbo.role_permissions rp
      INNER JOIN dbo.permissions p ON p.permission_id = rp.permission_id
      WHERE p.module_key IN (${list});`);

    await db.raw(`DELETE FROM dbo.permissions WHERE module_key IN (${list});`);

    // 2) modules master rows for the stale action-screens.
    await db.raw(`DELETE FROM dbo.modules WHERE module_code IN (${list});`);
  },
};
