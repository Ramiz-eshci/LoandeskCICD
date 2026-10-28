'use strict';

/**
 * Master: valuer_firms (Surveyor / Valuer firms for the Underwriting → Valuation
 * Instruction step). Was a hardcoded list; now a managed master like solicitors.
 * Standard convention: IDENTITY PK, unique business code, audit columns. Idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.valuer_firms','U') IS NULL CREATE TABLE dbo.valuer_firms (
        valuer_firm_id INT IDENTITY(1,1) PRIMARY KEY,
        code  NVARCHAR(30)  NOT NULL,
        name  NVARCHAR(150) NOT NULL,
        firm  NVARCHAR(150) NULL,
        email NVARCHAR(150) NULL,
        phone NVARCHAR(30)  NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT UQ_valuer_firms_code UNIQUE (code));`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.valuer_firms','U') IS NOT NULL DROP TABLE dbo.valuer_firms;`);
  },
};
