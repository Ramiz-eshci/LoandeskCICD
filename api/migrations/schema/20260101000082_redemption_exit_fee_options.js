'use strict';

/**
 * Migration: Redemption exit fee options (client 16-10-2026).
 *   loans.exit_fee_type   'amount' | 'months' | 'pct_gross' | 'pct_net' (NULL = legacy: loan_fees exit rows)
 *   loans.exit_fee_value  £ amount, number of months' interest, or % - depending on the type
 * Different lenders charge the exit fee differently, so it is chosen per facility
 * on the redemption calculator. Additive and idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

const LOAN = [
  ['exit_fee_type', 'exit_fee_type NVARCHAR(12) NULL'],
  ['exit_fee_value', 'exit_fee_value DECIMAL(18,4) NULL'],
];

module.exports = {
  async up(db) {
    for (const [c, d] of LOAN) await addCol(db, 'loans', c, d);
  },
  async down(db) {
    for (const [c] of LOAN) await dropCol(db, 'loans', c);
  },
};
