'use strict';

/**
 * Migration: Redemption changes (client 30-09-2026).
 *   loans.min_interest_months         minimum months' interest on early redemption (NULL = offer's
 *                                     minimum term, else 3)
 *   loans.redemption_interest_basis   'daily' | 'monthly' default for statements
 *   loan_redemptions.*                basis / days / months / minimum adjustment used, and who the
 *                                     statement was e-mailed to (statements are no longer saved
 *                                     to the facility documents). Additive and idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

const LOAN = [
  ['min_interest_months', 'min_interest_months INT NULL'],
  ['redemption_interest_basis', 'redemption_interest_basis NVARCHAR(10) NULL'],
];
const RED = [
  ['interest_basis', 'interest_basis NVARCHAR(10) NULL'],
  ['days_elapsed', 'days_elapsed INT NULL'],
  ['months_charged', 'months_charged INT NULL'],
  ['min_interest_months', 'min_interest_months INT NULL'],
  ['min_interest_adj', 'min_interest_adj DECIMAL(18,2) NULL'],
  ['monthly_interest', 'monthly_interest DECIMAL(18,2) NULL'],
  ['daily_interest', 'daily_interest DECIMAL(18,2) NULL'],
  ['emailed_to', 'emailed_to NVARCHAR(1000) NULL'],
  ['emailed_cc', 'emailed_cc NVARCHAR(1000) NULL'],
  ['emailed_at', 'emailed_at DATETIME2 NULL'],
  ['email_status', 'email_status NVARCHAR(20) NULL'],
  ['email_error', 'email_error NVARCHAR(1000) NULL'],
];

module.exports = {
  async up(db) {
    for (const [c, d] of LOAN) await addCol(db, 'loans', c, d);
    for (const [c, d] of RED) await addCol(db, 'loan_redemptions', c, d);
  },
  async down(db) {
    for (const [c] of RED) await dropCol(db, 'loan_redemptions', c);
    for (const [c] of LOAN) await dropCol(db, 'loans', c);
  },
};
