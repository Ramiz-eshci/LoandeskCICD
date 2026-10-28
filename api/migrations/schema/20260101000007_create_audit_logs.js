'use strict';

/** Migration: audit_logs (Doc-02 Section 19 + general audit-logging rule). */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.audit_logs','U') IS NULL
      CREATE TABLE dbo.audit_logs (
        audit_id    BIGINT IDENTITY(1,1) PRIMARY KEY,
        user_id     INT NULL,
        action      NVARCHAR(50)  NOT NULL,
        module_key  NVARCHAR(100) NULL,
        entity_name NVARCHAR(100) NULL,
        entity_id   NVARCHAR(60)  NULL,
        details     NVARCHAR(MAX) NULL,
        ip_address  NVARCHAR(60)  NULL,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_audit_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id)
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_entity') CREATE INDEX IX_audit_entity ON dbo.audit_logs(entity_name, entity_id);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_user') CREATE INDEX IX_audit_user ON dbo.audit_logs(user_id);`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_created') CREATE INDEX IX_audit_created ON dbo.audit_logs(created_at);`);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.audit_logs','U') IS NOT NULL DROP TABLE dbo.audit_logs;");
  },
};
