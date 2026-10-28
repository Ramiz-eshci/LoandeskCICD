'use strict';

/**
 * Migration: rename enquiry status LOST display name "Lost" -> "Declined".
 *
 * Only the display name changes; the business code stays 'LOST' so existing
 * enquiries (enquiries.enquiry_status_id) and any code lookups keep working.
 * Idempotent — safe to re-run.
 *
 * NOTE: the seeder 20260101000006_enquiry_statuses_perms.js was updated in the
 * same change to keep the catalogue in sync, otherwise a re-seed would revert
 * this name back to "Lost".
 */

module.exports = {
  async up(db) {
    await db.raw(
      `UPDATE dbo.enquiry_statuses SET name = 'Declined' WHERE code = 'LOST';`,
    );
  },

  async down(db) {
    await db.raw(
      `UPDATE dbo.enquiry_statuses SET name = 'Lost' WHERE code = 'LOST';`,
    );
  },
};
