'use strict';

/** Underwriting document/photo uploads (e.g. Site Visit property photos). Additive & idempotent. */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.underwriting_documents','U') IS NULL CREATE TABLE dbo.underwriting_documents (
        underwriting_document_id INT IDENTITY(1,1) PRIMARY KEY,
        underwriting_case_id INT NOT NULL,
        step_no      INT NULL,
        file_name    NVARCHAR(255) NOT NULL,
        file_path    NVARCHAR(500) NOT NULL,
        content_type NVARCHAR(120) NULL,
        uploaded_by  INT NULL,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_uw_doc_case FOREIGN KEY (underwriting_case_id) REFERENCES dbo.underwriting_cases(underwriting_case_id));`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_uw_doc_case')
        CREATE INDEX IX_uw_doc_case ON dbo.underwriting_documents(underwriting_case_id, step_no);`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.underwriting_documents','U') IS NOT NULL DROP TABLE dbo.underwriting_documents;`);
  },
};
