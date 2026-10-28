'use strict';

/**
 * Migration: Outlook -> Enquiry email intake (Module-4 add-on).
 *
 * Additive + idempotent (OBJECT_ID / COL_LENGTH / EXISTS guards) — never edits
 * an applied migration.
 *
 * Adds:
 *   - outlook_processed_emails : archive of every inbound message we ingested,
 *     the dedup key (message_id UNIQUE) and the link to the enquiry it created.
 *   - application_sources row 'EMAIL' so email-originated enquiries are tagged
 *     and filterable in the enquiry listing (joins application_sources.name).
 *
 * Attachments are stored via the existing enquiry_documents table (added in
 * 20260101000013), so no new attachment table is needed.
 */

module.exports = {
  async up(db) {
    /* ---------- outlook_processed_emails ---------- */
    await db.raw(`
      IF OBJECT_ID('dbo.outlook_processed_emails','U') IS NULL
      CREATE TABLE dbo.outlook_processed_emails (
        outlook_email_id    INT IDENTITY(1,1) PRIMARY KEY,
        message_id          NVARCHAR(512) NOT NULL,
        internet_message_id NVARCHAR(512) NULL,
        sender              NVARCHAR(320) NULL,
        subject             NVARCHAR(500) NULL,
        body_content        NVARCHAR(MAX) NULL,
        body_content_type   NVARCHAR(20)  NULL,
        received_at         DATETIME2 NULL,
        has_attachments     BIT NOT NULL DEFAULT 0,
        raw_amount          NVARCHAR(100) NULL,   -- extractor "val"        (as written)
        raw_term            NVARCHAR(100) NULL,   -- extractor "wantsUpTo"  (as written)
        property            NVARCHAR(500) NULL,   -- extractor "property"
        signer_name         NVARCHAR(200) NULL,   -- extractor "loanApply"
        enquiry_id          INT NULL,             -- the enquiry this email created
        status              NVARCHAR(30) NOT NULL DEFAULT 'processed',
        error_message       NVARCHAR(1000) NULL,
        processed_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        created_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_outlook_message UNIQUE (message_id),
        CONSTRAINT FK_outlook_enquiry FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id)
      );`);

    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_outlook_enquiry')
        CREATE INDEX IX_outlook_enquiry ON dbo.outlook_processed_emails(enquiry_id);`);

    /* ---------- application_sources: 'EMAIL' ---------- */
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM dbo.application_sources WHERE code = 'EMAIL')
        INSERT INTO dbo.application_sources (code, name) VALUES ('EMAIL', 'Email');`);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.outlook_processed_emails','U') IS NOT NULL DROP TABLE dbo.outlook_processed_emails;");
    await db.raw("DELETE FROM dbo.application_sources WHERE code = 'EMAIL';");
  },
};
