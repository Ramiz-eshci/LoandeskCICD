'use strict';

/**
 * Migration: Enquiry step 3 additions (client 15-10-2026).
 *   rep_type                       'single' | 'dual' - solicitor representation. Single rep ->
 *                                  the borrower has their own solicitor (fields below); dual ->
 *                                  our solicitor acts for both sides. Pre-fills underwriting
 *                                  step "Solicitor Quote" and section 5 of the application form.
 *   borrower_sol_firm / _contact / _address / _telephone / _email
 *                                  borrower's solicitor (single rep only).
 *   deal_appraisal, exit_strategy, risk_mitigants, credit_recommendation
 *                                  optional narrative printed on the Credit Deal Summary and
 *                                  the Credit Paper (previously always blank).
 * Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
const COLS = [
  ['rep_type', 'rep_type NVARCHAR(10) NULL'],
  ['borrower_sol_firm', 'borrower_sol_firm NVARCHAR(200) NULL'],
  ['borrower_sol_contact', 'borrower_sol_contact NVARCHAR(200) NULL'],
  ['borrower_sol_address', 'borrower_sol_address NVARCHAR(500) NULL'],
  ['borrower_sol_telephone', 'borrower_sol_telephone NVARCHAR(30) NULL'],
  ['borrower_sol_email', 'borrower_sol_email NVARCHAR(150) NULL'],
  ['deal_appraisal', 'deal_appraisal NVARCHAR(MAX) NULL'],
  ['exit_strategy', 'exit_strategy NVARCHAR(MAX) NULL'],
  ['risk_mitigants', 'risk_mitigants NVARCHAR(MAX) NULL'],
  ['credit_recommendation', 'credit_recommendation NVARCHAR(MAX) NULL'],
];
module.exports = {
  async up(db) {
    for (const [c, ddl] of COLS) await addCol(db, 'enquiries', c, ddl);
  },
  async down(db) {
    for (const [c] of COLS.slice().reverse()) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
  },
};
