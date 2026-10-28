'use strict';

/**
 * Migration: Enquiry — applicant-type conditional field + stored LTV.
 *   company_reg_no  (Step 2, Company / Multi-Party — Company Reg. No.)
 *   ltv_pct         (Step 3, Est. LTV — server-computed = amount / est. value * 100)
 * Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
module.exports = {
  async up(db) {
    await addCol(db, 'enquiries', 'company_reg_no', 'company_reg_no NVARCHAR(50) NULL');
    await addCol(db, 'enquiries', 'ltv_pct', 'ltv_pct DECIMAL(6,2) NULL');
  },
  async down(db) {
    for (const c of ['company_reg_no', 'ltv_pct']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
  },
};
