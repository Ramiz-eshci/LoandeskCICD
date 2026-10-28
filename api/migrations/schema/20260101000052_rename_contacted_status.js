'use strict';

/**
 * Migration: rename the CONTACTED enquiry status display name to
 * "Awaiting Information" (client 01-10-2026). Display name only — the status
 * CODE stays 'CONTACTED', so the workflow transition graph is untouched.
 * Idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`UPDATE dbo.enquiry_statuses SET name = 'Awaiting Information' WHERE code = 'CONTACTED';`);
  },
  async down(db) {
    await db.raw(`UPDATE dbo.enquiry_statuses SET name = 'Contacted' WHERE code = 'CONTACTED';`);
  },
};
