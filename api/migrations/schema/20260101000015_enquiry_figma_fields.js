'use strict';

/**
 * Migration: Enquiry Figma-parity fields (Module-4 form).
 * Adds the wizard fields missing from the schema:
 *   lead_source              (Step 1 — Lead Source picklist)
 *   broker_name              (Step 1 — Broker / Introducer free text)
 *   dob                      (Step 2 — Date of Birth)
 *   requested_completion_date(Step 3 — Requested Completion)
 * Additive + idempotent (COL_LENGTH guards).
 */

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'enquiries', 'lead_source', 'lead_source NVARCHAR(100) NULL');
    await addCol(db, 'enquiries', 'broker_name', 'broker_name NVARCHAR(200) NULL');
    await addCol(db, 'enquiries', 'dob', 'dob DATE NULL');
    await addCol(db, 'enquiries', 'requested_completion_date', 'requested_completion_date DATE NULL');
  },
  async down(db) {
    for (const c of ['lead_source', 'broker_name', 'dob', 'requested_completion_date']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
  },
};
