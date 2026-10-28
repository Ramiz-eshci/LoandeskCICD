'use strict';

/**
 * Migration: Roles matrix clean-up (client 29-09-2026) — same work as seeder
 * 20260101000061_permission_cleanup.js, run here so a plain `npm run migrate`
 * is enough. See the seeder for the full list. Idempotent.
 *
 * down() only restores the module rows (flag_deleted = 0); removed grants are not
 * restored — take a DB backup before running if you may need to roll back.
 */
const seeder = require('../seeders/20260101000061_permission_cleanup');

module.exports = {
  async up(db) {
    await seeder.run(db);
  },
  async down(db) {
    await db.raw(`
      UPDATE modules SET flag_deleted = 0 WHERE module_code IN (
        'APPLICATIONS.APPLICANT_DETAILS','APPLICATIONS.LOAN_DETAILS','APPLICATIONS.SECURITY_PROPERTY',
        'APPLICATIONS.BROKER','APPLICATIONS.DOCUMENTS','APPLICATIONS.TASKS','APPLICATIONS.COMMUNICATIONS',
        'APPLICATIONS.AUDIT','APPLICATIONS.ENQUIRY_DETAILS','APPLICATIONS.APPLICATION_READINESS',
        'VALUATION','CREDIT','LEGAL');
      UPDATE modules SET module_name = N'Offer' WHERE module_code = 'ENQUIRIES.OFFER';`);
  },
};
