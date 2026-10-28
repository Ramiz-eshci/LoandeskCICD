'use strict';

/**
 * Migration: enquiries.charge_amount (client enquiry changes 26-09-2026).
 *
 * When the main security's Charge = "2nd charge", step 4 of New Enquiry shows a
 * "Charge Amount (£)" box — the debt already secured ahead of us. It is added to
 * the debt side of the combined Est. LTV. Other securities (step 5) keep their
 * own charge_amount inside the additional_securities JSON, so no column there.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','charge_amount') IS NULL
      ALTER TABLE dbo.enquiries ADD charge_amount DECIMAL(18,2) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','charge_amount') IS NOT NULL
      ALTER TABLE dbo.enquiries DROP COLUMN charge_amount;`);
  },
};
