'use strict';

/**
 * Migration: enquiries.additional_securities — a flexible JSON column holding
 * the "other securities" captured in the New Enquiry step 5 (fields still
 * evolving, so stored as JSON rather than fixed columns).
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','additional_securities') IS NULL
      ALTER TABLE dbo.enquiries ADD additional_securities NVARCHAR(MAX) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','additional_securities') IS NOT NULL
      ALTER TABLE dbo.enquiries DROP COLUMN additional_securities;`);
  },
};
