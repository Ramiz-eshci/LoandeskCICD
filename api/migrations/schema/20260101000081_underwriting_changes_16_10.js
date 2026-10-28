'use strict';

/**
 * Migration: underwriting module changes (client 16-10-2026). Additive + idempotent.
 *
 *   borrower_solicitors.sra_no            SRA / regulator number on the Borrower's Solicitor master
 *                                         (the underwriting Solicitor Quote step shows it).
 *   borrower_solicitor_checks             Solicitor checks saved PER SOLICITOR (not per case), so
 *                                         picking a solicitor used before pre-ticks its checks
 *                                         with the date each was last updated.
 *   borrower_solicitor_documents          Evidence uploaded against a solicitor's check, kept with
 *                                         the solicitor so later cases see it too.
 *   solicitor_cost_types                  Master for the Solicitor Quote "Additional costs" names
 *                                         (dropdown instead of free text, for reporting by type).
 *   underwriting_cases.revised_offer_*    "Edit loan" now e-mails a revised offer letter to the
 *                                         broker; the case waits for the signed copy upload.
 */
const AUDIT = `
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL`;

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    // borrower_solicitors may be missing on a DB where 075/076 never ran - guard it.
    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitors','U') IS NOT NULL AND COL_LENGTH('dbo.borrower_solicitors','sra_no') IS NULL
      ALTER TABLE dbo.borrower_solicitors ADD sra_no NVARCHAR(50) NULL;`);

    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitor_checks','U') IS NULL CREATE TABLE dbo.borrower_solicitor_checks (
        borrower_solicitor_check_id INT IDENTITY(1,1) PRIMARY KEY,
        borrower_solicitor_id   INT NOT NULL,
        solicitor_check_item_id INT NOT NULL,
        done       BIT NOT NULL DEFAULT 0,
        notes      NVARCHAR(MAX) NULL,
        created_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by INT NULL,
        updated_at DATETIME2 NULL,
        CONSTRAINT UQ_borrower_solicitor_checks UNIQUE (borrower_solicitor_id, solicitor_check_item_id));`);

    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitor_documents','U') IS NULL CREATE TABLE dbo.borrower_solicitor_documents (
        borrower_solicitor_document_id INT IDENTITY(1,1) PRIMARY KEY,
        borrower_solicitor_id   INT NOT NULL,
        solicitor_check_item_id INT NULL,
        underwriting_case_id    INT NULL,
        file_name    NVARCHAR(255) NOT NULL,
        file_path    NVARCHAR(500) NOT NULL,
        content_type NVARCHAR(120) NULL,
        uploaded_by  INT NULL,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());`);

    await db.raw(`IF OBJECT_ID('dbo.solicitor_cost_types','U') IS NULL CREATE TABLE dbo.solicitor_cost_types (
        solicitor_cost_type_id INT IDENTITY(1,1) PRIMARY KEY,
        code       NVARCHAR(30)  NOT NULL,
        name       NVARCHAR(150) NOT NULL,
        sort_order INT NULL,
        ${AUDIT},
        CONSTRAINT UQ_solicitor_cost_types_code UNIQUE (code));`);

    await addCol(db, 'underwriting_cases', 'revised_offer_pending', 'revised_offer_pending BIT NOT NULL CONSTRAINT DF_uc_revised_offer_pending DEFAULT 0');
    await addCol(db, 'underwriting_cases', 'revised_offer_id', 'revised_offer_id INT NULL');
    await addCol(db, 'underwriting_cases', 'revised_offer_sent_at', 'revised_offer_sent_at DATETIME2 NULL');
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.DF_uc_revised_offer_pending','D') IS NOT NULL ALTER TABLE dbo.underwriting_cases DROP CONSTRAINT DF_uc_revised_offer_pending;`);
    await dropCol(db, 'underwriting_cases', 'revised_offer_sent_at');
    await dropCol(db, 'underwriting_cases', 'revised_offer_id');
    await dropCol(db, 'underwriting_cases', 'revised_offer_pending');
    await db.raw(`IF OBJECT_ID('dbo.solicitor_cost_types','U') IS NOT NULL DROP TABLE dbo.solicitor_cost_types;`);
    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitor_documents','U') IS NOT NULL DROP TABLE dbo.borrower_solicitor_documents;`);
    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitor_checks','U') IS NOT NULL DROP TABLE dbo.borrower_solicitor_checks;`);
    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitors','U') IS NOT NULL AND COL_LENGTH('dbo.borrower_solicitors','sra_no') IS NOT NULL
      ALTER TABLE dbo.borrower_solicitors DROP COLUMN sra_no;`);
  },
};
