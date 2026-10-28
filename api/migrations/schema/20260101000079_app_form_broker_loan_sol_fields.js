'use strict';

/**
 * Migration: application form fields (client 15-10-2026).
 *   brokers.address, brokers.fca_number          section 1 "Introducer Details" (broker master)
 *   borrower_solicitors.sra_partners, solicitors.sra_partners
 *                                                 section 5 "Number of SRA Partners"
 *   enquiries.total_project_cost / deposit_source / own_contribution / additional_borrowing
 *                                                 section 2 "Loan Details" - New Enquiry step 3
 *                                                 (Exit Strategy reuses enquiries.exit_strategy).
 * Additive + idempotent.
 */
const COLS = [
  ['brokers', 'address', 'address NVARCHAR(500) NULL'],
  ['brokers', 'fca_number', 'fca_number NVARCHAR(50) NULL'],
  ['borrower_solicitors', 'sra_partners', 'sra_partners INT NULL'],
  ['solicitors', 'sra_partners', 'sra_partners INT NULL'],
  ['enquiries', 'total_project_cost', 'total_project_cost DECIMAL(18,2) NULL'],
  ['enquiries', 'deposit_source', 'deposit_source NVARCHAR(500) NULL'],
  ['enquiries', 'own_contribution', 'own_contribution DECIMAL(18,2) NULL'],
  ['enquiries', 'additional_borrowing', 'additional_borrowing BIT NULL'],
];

module.exports = {
  async up(db) {
    for (const [t, c, ddl] of COLS) {
      await db.raw(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL AND COL_LENGTH('dbo.${t}','${c}') IS NULL ALTER TABLE dbo.${t} ADD ${ddl};`);
    }
  },
  async down(db) {
    for (const [t, c] of COLS.slice().reverse()) {
      await db.raw(`IF COL_LENGTH('dbo.${t}','${c}') IS NOT NULL ALTER TABLE dbo.${t} DROP COLUMN ${c};`);
    }
  },
};
