'use strict';

/**
 * Migration: loan_redemptions.figures_json (client 22-10-2026).
 * The full set of figures a statement was issued with, so a re-opened / re-sent statement
 * shows exactly what the preview and the first e-mail showed. Additive + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.loan_redemptions','figures_json') IS NULL ALTER TABLE dbo.loan_redemptions ADD figures_json NVARCHAR(MAX) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.loan_redemptions','figures_json') IS NOT NULL ALTER TABLE dbo.loan_redemptions DROP COLUMN figures_json;`);
  },
};
