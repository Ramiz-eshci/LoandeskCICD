'use strict';

/**
 * Migration: add underwriting_cases.underwriter_notes (client 07-10-2026).
 *
 * The underwriter asked for a general notes scratchpad alongside the stepper,
 * outside the step process — somewhere to jot little reminders about the deal
 * (previously pen and paper). One free-text note per case. Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'underwriting_cases', 'underwriter_notes', 'underwriter_notes NVARCHAR(MAX) NULL');
  },
  async down(db) {
    await dropCol(db, 'underwriting_cases', 'underwriter_notes');
  },
};
