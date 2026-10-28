'use strict';

/**
 * Module-4: initial-offer fields on enquiries (for the Initial Offer tab).
 * Additive & idempotent.
 */
module.exports = {
  async up(db) {
    const cols = [
      ['offer_amount', 'DECIMAL(18,2)'],
      ['offer_rate', 'DECIMAL(9,4)'],
      ['offer_valid_until', 'DATE'],
      ['offer_notes', 'NVARCHAR(MAX)'],
      ['offer_sent_at', 'DATETIME2'],
    ];
    for (const [c, t] of cols) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NULL ALTER TABLE dbo.enquiries ADD ${c} ${t} NULL;`);
    }
  },
  async down(db) {
    for (const c of ['offer_amount', 'offer_rate', 'offer_valid_until', 'offer_notes', 'offer_sent_at']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
  },
};
