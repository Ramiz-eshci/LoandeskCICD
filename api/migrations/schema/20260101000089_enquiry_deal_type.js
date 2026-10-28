'use strict';

/**
 * Migration: Type of Deal on the enquiry (client 26-10-2026).
 *   deal_type   'Residential' | 'Commercial' | 'Mixed' - a structured deal-level type so the
 *               Overall Summary report can break the "Average Time Taken" down by it
 *               (property_type stays the free-text description of the security).
 * Additive + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','deal_type') IS NULL ALTER TABLE dbo.enquiries ADD deal_type NVARCHAR(20) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','deal_type') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN deal_type;`);
  },
};
