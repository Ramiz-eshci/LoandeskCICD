'use strict';

/**
 * Migration: enquiry drawdowns + security map link (client enquiry changes 25-09-2026).
 *
 *  - drawdowns_required BIT          — "Drawdowns required?" on New Enquiry step 3 (Loan Request)
 *  - drawdowns          NVARCHAR(MAX) — JSON list [{ month, amount }] captured with the enquiry;
 *                                       pre-fills the Send Indicatives popup
 *  - map_link           NVARCHAR(1000) — Google Maps link for the main security (Security tab map)
 */
module.exports = {
  async up(db) {
    await db.raw(`
      IF COL_LENGTH('dbo.enquiries','drawdowns_required') IS NULL
        ALTER TABLE dbo.enquiries ADD drawdowns_required BIT NULL;
      IF COL_LENGTH('dbo.enquiries','drawdowns') IS NULL
        ALTER TABLE dbo.enquiries ADD drawdowns NVARCHAR(MAX) NULL;
      IF COL_LENGTH('dbo.enquiries','map_link') IS NULL
        ALTER TABLE dbo.enquiries ADD map_link NVARCHAR(1000) NULL;`);
  },
  async down(db) {
    await db.raw(`
      IF COL_LENGTH('dbo.enquiries','map_link') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN map_link;
      IF COL_LENGTH('dbo.enquiries','drawdowns') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN drawdowns;
      IF COL_LENGTH('dbo.enquiries','drawdowns_required') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN drawdowns_required;`);
  },
};
