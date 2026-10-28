'use strict';

/**
 * Master: kyc_team — KYC team members an underwriting KYC / AML entry is assigned to
 * (client 28-09-2026). Name required; mobile and email optional.
 * Standard master convention: IDENTITY PK, unique auto code, audit columns. Idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.kyc_team','U') IS NULL CREATE TABLE dbo.kyc_team (
        kyc_team_id  INT IDENTITY(1,1) PRIMARY KEY,
        code         NVARCHAR(30)  NOT NULL,
        name         NVARCHAR(150) NOT NULL,
        phone        NVARCHAR(30)  NULL,
        email        NVARCHAR(150) NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT UQ_kyc_team_code UNIQUE (code));`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.kyc_team','U') IS NOT NULL DROP TABLE dbo.kyc_team;`);
  },
};
