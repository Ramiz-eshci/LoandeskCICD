'use strict';

/** Master: lead_sources (Enquiry "Lead Source" — was a hardcoded list). Standard master shape. Idempotent. */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.lead_sources','U') IS NULL CREATE TABLE dbo.lead_sources (
        lead_source_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30)  NOT NULL,
        name NVARCHAR(150) NOT NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT UQ_lead_sources_code UNIQUE (code));`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.lead_sources','U') IS NOT NULL DROP TABLE dbo.lead_sources;`);
  },
};
