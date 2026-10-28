'use strict';

/**
 * Migration: Portfolio Extensions workflow + Bad loans (client 30-09-2026).
 *
 *   portfolio_extensions           one row per extension request on a facility
 *                                  (fees, interest treatment, agreement, paper, decision)
 *   portfolio_extension_documents  files linked to an extension (exit evidence,
 *                                  generated agreement, signed agreement, request paper)
 *   loan_recoveries                money actually received on a bad loan (instalments)
 *   loans.*                        bad-debt note (single field + timestamp) and write-off columns
 *
 * Then runs seeder 20260101000063 (Head of Extension / Bad Debt permissions, document
 * types) so a plain `npm run migrate` is enough. Additive and idempotent.
 */
const seeder = require('../seeders/20260101000063_extension_bad_loan_perms');

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}
async function IX(db, ix, tbl, cols) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`);
}

const LOAN_COLS = [
  ['bad_debt_at', 'bad_debt_at DATETIME2 NULL'],
  ['bad_debt_by', 'bad_debt_by INT NULL'],
  ['bad_debt_note', 'bad_debt_note NVARCHAR(MAX) NULL'],
  ['bad_debt_note_at', 'bad_debt_note_at DATETIME2 NULL'],
  ['bad_debt_note_by', 'bad_debt_note_by INT NULL'],
  ['written_off_at', 'written_off_at DATETIME2 NULL'],
  ['written_off_by', 'written_off_by INT NULL'],
  ['write_off_amount', 'write_off_amount DECIMAL(18,2) NULL'],
  ['write_off_reason', 'write_off_reason NVARCHAR(MAX) NULL'],
];

module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.portfolio_extensions','U') IS NULL
      CREATE TABLE dbo.portfolio_extensions (
        extension_id          INT IDENTITY(1,1) PRIMARY KEY,
        extension_ref         NVARCHAR(30) NULL,
        loan_id               INT NOT NULL,
        status                NVARCHAR(30) NOT NULL DEFAULT 'Draft',
        current_maturity      DATE NULL,
        extension_months      INT NOT NULL DEFAULT 1,
        new_maturity          DATE NULL,
        gross_amount          DECIMAL(18,2) NULL,
        net_amount            DECIMAL(18,2) NULL,
        monthly_rate_pct      DECIMAL(9,4) NULL,
        ext_fee_type          NVARCHAR(10) NOT NULL DEFAULT 'PCT',
        ext_fee_value         DECIMAL(18,4) NULL,
        ext_fee_amount        DECIMAL(18,2) NULL,
        ext_fee_timing        NVARCHAR(20) NOT NULL DEFAULT 'Upfront',
        ext_fee_due_date      DATE NULL,
        doc_fee_type          NVARCHAR(10) NOT NULL DEFAULT 'AMOUNT',
        doc_fee_value         DECIMAL(18,4) NULL,
        doc_fee_amount        DECIMAL(18,2) NULL,
        doc_fee_timing        NVARCHAR(20) NOT NULL DEFAULT 'Upfront',
        doc_fee_due_date      DATE NULL,
        interest_treatment    NVARCHAR(20) NOT NULL DEFAULT 'Serviced',
        monthly_interest      DECIMAL(18,2) NULL,
        first_payment_date    DATE NULL,
        exit_plan             NVARCHAR(MAX) NULL,
        doc_json              NVARCHAR(MAX) NULL,
        agreement_date        DATE NULL,
        agreement_sent_to     NVARCHAR(320) NULL,
        agreement_sent_at     DATETIME2 NULL,
        agreement_document_id INT NULL,
        signed_document_id    INT NULL,
        request_document_id   INT NULL,
        submitted_by          INT NULL,
        submitted_at          DATETIME2 NULL,
        decision              NVARCHAR(20) NULL,
        decision_notes        NVARCHAR(MAX) NULL,
        decided_by            INT NULL,
        decided_at            DATETIME2 NULL,
        applied_at            DATETIME2 NULL,
        flag_deleted          BIT NOT NULL DEFAULT 0,
        created_by            INT NULL,
        created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by            INT NULL,
        updated_at            DATETIME2 NULL,
        CONSTRAINT FK_pext_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id)
      );`);
    await IX(db, 'IX_pext_loan', 'portfolio_extensions', 'loan_id, created_at DESC');
    await IX(db, 'IX_pext_status', 'portfolio_extensions', 'status, created_at DESC');

    await db.raw(`
      IF OBJECT_ID('dbo.portfolio_extension_documents','U') IS NULL
      CREATE TABLE dbo.portfolio_extension_documents (
        ext_doc_id       INT IDENTITY(1,1) PRIMARY KEY,
        extension_id     INT NOT NULL,
        app_document_id  INT NOT NULL,
        kind             NVARCHAR(30) NOT NULL,
        flag_deleted     BIT NOT NULL DEFAULT 0,
        created_by       INT NULL,
        created_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_pextdoc_ext FOREIGN KEY (extension_id) REFERENCES dbo.portfolio_extensions(extension_id)
      );`);
    await IX(db, 'IX_pextdoc_ext', 'portfolio_extension_documents', 'extension_id');

    await db.raw(`
      IF OBJECT_ID('dbo.loan_recoveries','U') IS NULL
      CREATE TABLE dbo.loan_recoveries (
        recovery_id   INT IDENTITY(1,1) PRIMARY KEY,
        loan_id       INT NOT NULL,
        received_on   DATE NOT NULL,
        amount        DECIMAL(18,2) NOT NULL,
        method        NVARCHAR(30) NULL,
        reference     NVARCHAR(80) NULL,
        notes         NVARCHAR(1000) NULL,
        flag_deleted  BIT NOT NULL DEFAULT 0,
        created_by    INT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_lrec_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id)
      );`);
    await IX(db, 'IX_lrec_loan', 'loan_recoveries', 'loan_id, received_on');

    for (const [col, ddl] of LOAN_COLS) await addCol(db, 'loans', col, ddl);
    await IX(db, 'IX_loan_status', 'loans', 'status');

    await seeder.run(db);
  },

  async down(db) {
    for (const [col] of LOAN_COLS) await dropCol(db, 'loans', col);
    await db.raw("IF OBJECT_ID('dbo.loan_recoveries','U') IS NOT NULL DROP TABLE dbo.loan_recoveries;");
    await db.raw("IF OBJECT_ID('dbo.portfolio_extension_documents','U') IS NOT NULL DROP TABLE dbo.portfolio_extension_documents;");
    await db.raw("IF OBJECT_ID('dbo.portfolio_extensions','U') IS NOT NULL DROP TABLE dbo.portfolio_extensions;");
    // Permission rows / modules are left in place (grants may exist); remove from Roles if unwanted.
  },
};
