'use strict';

/**
 * Migration: link loan_payments to the customer (applicant).
 *
 * A payment always belongs to a facility (loan_id, for per-facility allocation
 * against loan_schedules), but a customer can hold several facilities, so the
 * customer link makes Customer-360 payment history and cross-facility queries
 * trivial — same pattern as portfolio_contact_logs, which carries
 * loan_id + application_id + applicant_id.
 *
 * applicant_id is filled automatically on insert (resolved from the loan's
 * primary applicant) and the endpoint rejects a mismatched applicant, so the
 * two IDs can never contradict each other.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function addFk(db, name, table, ddl) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${name}') ALTER TABLE dbo.${table} ADD CONSTRAINT ${name} ${ddl};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'loan_payments', 'applicant_id', 'applicant_id INT NULL');
    await addFk(db, 'FK_pay_applicant', 'loan_payments', 'FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)');
    await db.raw(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pay_applicant')
         CREATE INDEX IX_pay_applicant ON dbo.loan_payments(applicant_id);`,
    );
    // Backfill existing rows from each loan's primary applicant.
    await db.raw(
      `UPDATE p SET applicant_id = pa.applicant_id
         FROM dbo.loan_payments p
         JOIN dbo.loans l ON l.loan_id = p.loan_id
         JOIN dbo.applications a ON a.application_id = l.application_id
         CROSS APPLY (
           SELECT TOP 1 aa.applicant_id
             FROM dbo.application_applicants aa
            WHERE aa.application_id = a.application_id
            ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id
         ) pa
        WHERE p.applicant_id IS NULL;`,
    );
  },

  async down(db) {
    await db.raw(
      `IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_pay_applicant')
         ALTER TABLE dbo.loan_payments DROP CONSTRAINT FK_pay_applicant;`,
    );
    await db.raw(
      `IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pay_applicant')
         DROP INDEX IX_pay_applicant ON dbo.loan_payments;`,
    );
    await db.raw(
      `IF COL_LENGTH('dbo.loan_payments','applicant_id') IS NOT NULL
         ALTER TABLE dbo.loan_payments DROP COLUMN applicant_id;`,
    );
  },
};
