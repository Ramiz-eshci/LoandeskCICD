'use strict';

/**
 * Migration (client 07-10-2026): underwriting_cases.status_before_hold — remembers
 * the status a case had before it was put "On Hold", so Resume restores it.
 * Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}
module.exports = {
  async up(db) { await addCol(db, 'underwriting_cases', 'status_before_hold', 'status_before_hold NVARCHAR(30) NULL'); },
  async down(db) { await dropCol(db, 'underwriting_cases', 'status_before_hold'); },
};
