'use strict';

/**
 * Migration: Email Settings master + Email History (client 17-10-2026).
 *
 *   email_event_settings     one row per e-mail (event_key from config/emailEvents.config.js):
 *                            keep the system CC or not, custom subject / body (NULL = system text)
 *   email_event_cc_rules     extra people copied in: a user, a role (every active user in it)
 *                            or a dynamic person (BDM / Underwriter on the case, the sender)
 *   email_event_attachments  extra files added to every e-mail of that type
 *   email_log                every e-mail the system sends (or fails to send), with module,
 *                            record id and reference number, To / CC, subject and status
 *
 * Additive and idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.email_event_settings','U') IS NULL
      CREATE TABLE dbo.email_event_settings (
        event_key          NVARCHAR(60)  NOT NULL PRIMARY KEY,
        include_default_cc BIT           NOT NULL DEFAULT 1,
        subject_template   NVARCHAR(500) NULL,
        body_template      NVARCHAR(MAX) NULL,
        updated_by         INT NULL,
        updated_at         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );`);

    await db.raw(`
      IF OBJECT_ID('dbo.email_event_cc_rules','U') IS NULL
      CREATE TABLE dbo.email_event_cc_rules (
        rule_id     INT IDENTITY(1,1) PRIMARY KEY,
        event_key   NVARCHAR(60) NOT NULL,
        rule_type   NVARCHAR(10) NOT NULL,   -- USER | ROLE | DYNAMIC
        user_id     INT NULL,
        role_id     INT NULL,
        dynamic_key NVARCHAR(30) NULL,       -- BDM | UNDERWRITER | SENDER
        created_by  INT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_eccr_type CHECK (rule_type IN ('USER','ROLE','DYNAMIC'))
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_eccr_event') CREATE INDEX IX_eccr_event ON dbo.email_event_cc_rules(event_key);`);

    await db.raw(`
      IF OBJECT_ID('dbo.email_event_attachments','U') IS NULL
      CREATE TABLE dbo.email_event_attachments (
        attachment_id INT IDENTITY(1,1) PRIMARY KEY,
        event_key     NVARCHAR(60)  NOT NULL,
        file_name     NVARCHAR(255) NOT NULL,
        file_path     NVARCHAR(500) NOT NULL,
        content_type  NVARCHAR(120) NULL,
        size_bytes    INT NULL,
        flag_deleted  BIT NOT NULL DEFAULT 0,
        created_by    INT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_eeatt_event') CREATE INDEX IX_eeatt_event ON dbo.email_event_attachments(event_key);`);

    await db.raw(`
      IF OBJECT_ID('dbo.email_log','U') IS NULL
      CREATE TABLE dbo.email_log (
        email_log_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        event_key    NVARCHAR(60)   NULL,
        module       NVARCHAR(30)   NULL,   -- ENQUIRY | APPLICATION | UNDERWRITING | EXTENSION | REDEMPTION | AUTH
        record_id    INT            NULL,
        record_ref   NVARCHAR(60)   NULL,   -- enquiry / application / extension ref, loan number
        to_list      NVARCHAR(2000) NOT NULL,
        cc_list      NVARCHAR(2000) NULL,
        subject      NVARCHAR(500)  NULL,
        body         NVARCHAR(MAX)  NULL,   -- NULL for security e-mails (OTP / reset)
        attachments  NVARCHAR(2000) NULL,   -- file names, comma separated
        status       NVARCHAR(10)   NOT NULL, -- Sent | Failed
        error        NVARCHAR(1000) NULL,
        transport    NVARCHAR(10)   NULL,   -- graph | smtp
        sent_by      INT            NULL,
        sent_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_email_log_sent') CREATE INDEX IX_email_log_sent ON dbo.email_log(sent_at DESC);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_email_log_record') CREATE INDEX IX_email_log_record ON dbo.email_log(module, record_id);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_email_log_ref') CREATE INDEX IX_email_log_ref ON dbo.email_log(record_ref);`);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.email_log','U') IS NOT NULL DROP TABLE dbo.email_log;");
    await db.raw("IF OBJECT_ID('dbo.email_event_attachments','U') IS NOT NULL DROP TABLE dbo.email_event_attachments;");
    await db.raw("IF OBJECT_ID('dbo.email_event_cc_rules','U') IS NOT NULL DROP TABLE dbo.email_event_cc_rules;");
    await db.raw("IF OBJECT_ID('dbo.email_event_settings','U') IS NOT NULL DROP TABLE dbo.email_event_settings;");
  },
};
