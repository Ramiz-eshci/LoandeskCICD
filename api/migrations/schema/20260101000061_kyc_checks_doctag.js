'use strict';

/**
 * Migration (client 07-10-2026):
 *  - kyc_check_items: master list of KYC checks, typed per applicant type
 *    (Individual / Company). Editable in Masters; drives the KYC / AML step.
 *  - underwriting_documents.doc_tag: ties a step document to a specific checklist
 *    item (e.g. 'kyc:12'), so each check can carry its own upload(s).
 * Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.kyc_check_items','U') IS NULL CREATE TABLE dbo.kyc_check_items (
        kyc_check_item_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        applicant_type_id INT NULL,
        name NVARCHAR(200) NOT NULL,
        sort_order INT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by INT NULL,
        updated_at DATETIME2 NULL,
        deleted_on DATETIME2 NULL,
        CONSTRAINT UQ_kyc_check_items_code UNIQUE (code),
        CONSTRAINT FK_kyc_check_apptype FOREIGN KEY (applicant_type_id) REFERENCES dbo.applicant_types(applicant_type_id));`);
    await addCol(db, 'underwriting_documents', 'doc_tag', 'doc_tag NVARCHAR(150) NULL');
  },
  async down(db) {
    await dropCol(db, 'underwriting_documents', 'doc_tag');
    await db.raw(`IF OBJECT_ID('dbo.kyc_check_items','U') IS NOT NULL DROP TABLE dbo.kyc_check_items;`);
  },
};
