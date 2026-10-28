'use strict';

/**
 * Migration: notes on an indicative (client 20-10-2026, Head of Sales).
 * Free text typed on Send Indicatives that is e-mailed to the broker below the
 * indicative terms (e.g. "Subject to due diligence on source of funds").
 * Additive + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiry_indicatives','notes') IS NULL ALTER TABLE dbo.enquiry_indicatives ADD notes NVARCHAR(MAX) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiry_indicatives','notes') IS NOT NULL ALTER TABLE dbo.enquiry_indicatives DROP COLUMN notes;`);
  },
};
