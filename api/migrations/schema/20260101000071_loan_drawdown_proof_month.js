'use strict';

/**
 * Migration: drawdown registration fields (client 09-10-2026).
 *   loan_drawdowns.agreed_month  INT  — the indicative drawdown month this tranche fulfils
 *                                       (ties a released tranche to an agreed_terms drawdown).
 *   loan_drawdowns.document_id   INT  — proof document uploaded when releasing the tranche
 *                                       (evidence the borrower did the agreed work).
 * Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
module.exports = {
  async up(db) {
    await addCol(db, 'loan_drawdowns', 'agreed_month', 'agreed_month INT NULL');
    await addCol(db, 'loan_drawdowns', 'document_id', 'document_id INT NULL');
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.loan_drawdowns','document_id') IS NOT NULL ALTER TABLE dbo.loan_drawdowns DROP COLUMN document_id;`);
    await db.raw(`IF COL_LENGTH('dbo.loan_drawdowns','agreed_month') IS NOT NULL ALTER TABLE dbo.loan_drawdowns DROP COLUMN agreed_month;`);
  },
};
