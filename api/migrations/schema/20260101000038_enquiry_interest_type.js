'use strict';

/**
 * Migration: enquiries.interest_type — the interest financing type chosen on
 * the New Enquiry form (Serviced / Retained / Rolled Up). Feeds the default
 * interest type in the Send Indicatives calculation.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','interest_type') IS NULL
      ALTER TABLE dbo.enquiries ADD interest_type NVARCHAR(20) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','interest_type') IS NOT NULL
      ALTER TABLE dbo.enquiries DROP COLUMN interest_type;`);
  },
};
