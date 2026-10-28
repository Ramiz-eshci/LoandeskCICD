'use strict';

/**
 * Enquiry decline reasons (client 29-09-2026).
 *
 *  - decline_reasons            : master list the Decline popup picks from
 *                                 (Asset Type, Over Leverage, Loan Size, ...).
 *  - enquiry_declines           : one row per decline of an enquiry. Keeps the
 *                                 free-text notes, who/when, the status the
 *                                 enquiry was in before, and — when it is
 *                                 brought back alive — who/when/why it was re-opened.
 *  - enquiry_decline_reason_map : the reasons ticked on that decline (many per
 *                                 decline). The reason name is snapshotted so the
 *                                 "why are deals rejected" data survives a
 *                                 master rename / deactivation.
 * Idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.decline_reasons','U') IS NULL CREATE TABLE dbo.decline_reasons (
        decline_reason_id INT IDENTITY(1,1) PRIMARY KEY,
        code         NVARCHAR(40)  NOT NULL,
        name         NVARCHAR(200) NOT NULL,
        sort_order   INT NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT UQ_decline_reasons_code UNIQUE (code));`);

    await db.raw(`IF OBJECT_ID('dbo.enquiry_declines','U') IS NULL CREATE TABLE dbo.enquiry_declines (
        enquiry_decline_id   INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_id           INT NOT NULL,
        notes                NVARCHAR(2000) NULL,
        previous_status_code NVARCHAR(40) NULL,
        declined_by          INT NULL,
        declined_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        reopened_by          INT NULL,
        reopened_at          DATETIME2 NULL,
        reopen_note          NVARCHAR(1000) NULL);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_enquiry_declines_enquiry')
        CREATE INDEX IX_enquiry_declines_enquiry ON dbo.enquiry_declines (enquiry_id, enquiry_decline_id);`);

    await db.raw(`IF OBJECT_ID('dbo.enquiry_decline_reason_map','U') IS NULL CREATE TABLE dbo.enquiry_decline_reason_map (
        enquiry_decline_reason_map_id INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_decline_id INT NOT NULL,
        decline_reason_id  INT NOT NULL,
        reason_name        NVARCHAR(200) NOT NULL,
        CONSTRAINT FK_edrm_decline FOREIGN KEY (enquiry_decline_id) REFERENCES dbo.enquiry_declines (enquiry_decline_id) ON DELETE CASCADE);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_edrm_reason')
        CREATE INDEX IX_edrm_reason ON dbo.enquiry_decline_reason_map (decline_reason_id);`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.enquiry_decline_reason_map','U') IS NOT NULL DROP TABLE dbo.enquiry_decline_reason_map;`);
    await db.raw(`IF OBJECT_ID('dbo.enquiry_declines','U') IS NOT NULL DROP TABLE dbo.enquiry_declines;`);
    await db.raw(`IF OBJECT_ID('dbo.decline_reasons','U') IS NOT NULL DROP TABLE dbo.decline_reasons;`);
  },
};
