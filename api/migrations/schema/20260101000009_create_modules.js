'use strict';

/**
 * Migration: modules master (dynamic module/screen hierarchy).
 * Seeded from the LoanDesk modules sheet. Drives the dynamic permission matrix
 * (and, later, a dynamic menu). module_code is the stable key used by
 * permissions.module_key.
 */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.modules','U') IS NULL
      CREATE TABLE dbo.modules (
        module_id    INT IDENTITY(1,1) PRIMARY KEY,
        module_code  NVARCHAR(150) NOT NULL,
        module_name  NVARCHAR(200) NOT NULL,
        parent_code  NVARCHAR(150) NULL,
        sort_order   INT NOT NULL DEFAULT 0,
        icon         NVARCHAR(60) NULL,
        route        NVARCHAR(150) NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_modules_code UNIQUE (module_code)
      );`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_modules_parent') CREATE INDEX IX_modules_parent ON dbo.modules(parent_code);`);
  },
  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.modules','U') IS NOT NULL DROP TABLE dbo.modules;");
  },
};
