'use strict';

/** Migration: create refresh_tokens (single-use, hashed) */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.refresh_tokens','U') IS NULL
      CREATE TABLE dbo.refresh_tokens (
        jti         UNIQUEIDENTIFIER PRIMARY KEY,
        user_id     INT NOT NULL,
        token_hash  CHAR(64) NOT NULL,
        csrf_hash   CHAR(64) NOT NULL,
        expires_at  DATETIME2 NOT NULL,
        revoked     BIT NOT NULL DEFAULT 0,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );`);
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_refresh_user')
      CREATE INDEX IX_refresh_user ON dbo.refresh_tokens(user_id);`);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.refresh_tokens','U') IS NOT NULL DROP TABLE dbo.refresh_tokens;");
  },
};
