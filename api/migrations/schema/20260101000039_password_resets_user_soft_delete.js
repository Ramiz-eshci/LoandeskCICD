'use strict';

/**
 * Migration: Forgot-password + user soft delete.
 *
 *  1. password_resets — single-use, time-boxed reset links. Only the SHA-256
 *     hash of the token is stored; the raw token lives only in the email link.
 *  2. users.deleted_on / users.deleted_by — soft-delete audit columns
 *     (flag_deleted already exists).
 *  3. users.email uniqueness moves from a table constraint to a FILTERED
 *     unique index (flag_deleted = 0) so a soft-deleted user's email can be
 *     reused for a new user or given to another user on edit.
 * Additive + guarded; safe to re-run.
 */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.password_resets','U') IS NULL
      CREATE TABLE dbo.password_resets (
        reset_id     INT IDENTITY(1,1) PRIMARY KEY,
        user_id      INT NOT NULL,
        token_hash   CHAR(64) NOT NULL,
        expires_at   DATETIME2 NOT NULL,
        consumed     BIT NOT NULL DEFAULT 0,
        consumed_at  DATETIME2 NULL,
        request_ip   NVARCHAR(64) NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_pwreset_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id)
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_pwreset_token') CREATE UNIQUE INDEX UX_pwreset_token ON dbo.password_resets(token_hash);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pwreset_user') CREATE INDEX IX_pwreset_user ON dbo.password_resets(user_id);`);

    await db.raw(`IF COL_LENGTH('dbo.users','deleted_on') IS NULL ALTER TABLE dbo.users ADD deleted_on DATETIME2 NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.users','deleted_by') IS NULL ALTER TABLE dbo.users ADD deleted_by INT NULL;`);

    await db.raw(`
      IF EXISTS (SELECT 1 FROM sys.objects WHERE name='UQ_users_email' AND type='UQ')
        ALTER TABLE dbo.users DROP CONSTRAINT UQ_users_email;`);
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_users_email_active')
        CREATE UNIQUE INDEX UX_users_email_active ON dbo.users(email) WHERE flag_deleted = 0;`);
  },

  async down(db) {
    await db.raw("IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_users_email_active') DROP INDEX UX_users_email_active ON dbo.users;");
    await db.raw("IF OBJECT_ID('dbo.password_resets','U') IS NOT NULL DROP TABLE dbo.password_resets;");
    await db.raw("IF COL_LENGTH('dbo.users','deleted_by') IS NOT NULL ALTER TABLE dbo.users DROP COLUMN deleted_by;");
    // deleted_on / UQ_users_email are intentionally not restored (would fail if
    // soft-deleted duplicates exist).
  },
};
