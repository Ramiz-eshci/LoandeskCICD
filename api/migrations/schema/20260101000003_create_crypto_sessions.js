'use strict';

/** Migration: create crypto_sessions (transport-encryption handshake store) */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.crypto_sessions','U') IS NULL
      CREATE TABLE dbo.crypto_sessions (
        id_hash    CHAR(64) NOT NULL PRIMARY KEY,
        key_blob   NVARCHAR(MAX) NOT NULL,
        expires_at DATETIME2 NOT NULL,
        revoked    BIT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );`);
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_crypto_expires')
      CREATE INDEX IX_crypto_expires ON dbo.crypto_sessions(expires_at);`);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.crypto_sessions','U') IS NOT NULL DROP TABLE dbo.crypto_sessions;");
  },
};
