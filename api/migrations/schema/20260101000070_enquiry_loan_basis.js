'use strict';

/**
 * Migration: Enquiry — loan amount basis (client 09-10-2026).
 *   loan_basis  'Gross' | 'Net' — whether the Step 3 loan amount is the gross or
 *               net figure. Drives the Est. LTV label (Gross LTV / Net LTV).
 * Additive + idempotent. Default 'Gross' (existing behaviour).
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
module.exports = {
  async up(db) {
    await addCol(db, 'enquiries', 'loan_basis', "loan_basis NVARCHAR(10) NULL CONSTRAINT DF_enquiries_loan_basis DEFAULT 'Gross'");
  },
  async down(db) {
    await db.raw(`IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name='DF_enquiries_loan_basis') ALTER TABLE dbo.enquiries DROP CONSTRAINT DF_enquiries_loan_basis;`);
    await db.raw(`IF COL_LENGTH('dbo.enquiries','loan_basis') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN loan_basis;`);
  },
};
