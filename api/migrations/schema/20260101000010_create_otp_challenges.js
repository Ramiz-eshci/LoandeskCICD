'use strict';

/** Migration: otp_challenges — short-lived login OTP challenges (2-step login). */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.otp_challenges','U') IS NULL
      CREATE TABLE dbo.otp_challenges (
        challenge_id UNIQUEIDENTIFIER PRIMARY KEY,
        user_id      INT NOT NULL,
        otp_hash     CHAR(64) NOT NULL,
        expires_at   DATETIME2 NOT NULL,
        attempts     INT NOT NULL DEFAULT 0,
        consumed     BIT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_otp_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id)
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_otp_user') CREATE INDEX IX_otp_user ON dbo.otp_challenges(user_id);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_otp_expires') CREATE INDEX IX_otp_expires ON dbo.otp_challenges(expires_at);`);
  },
  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.otp_challenges','U') IS NOT NULL DROP TABLE dbo.otp_challenges;");
  },
};
