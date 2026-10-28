'use strict';

/**
 * Migration (client 07-10-2026): solicitor_check_items — master list of checks run
 * on the BORROWER's solicitor (single rep only). Editable in Masters; drives the
 * Solicitor Quote step checklist. Additive + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.solicitor_check_items','U') IS NULL CREATE TABLE dbo.solicitor_check_items (
        solicitor_check_item_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        name NVARCHAR(200) NOT NULL,
        sort_order INT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by INT NULL,
        updated_at DATETIME2 NULL,
        deleted_on DATETIME2 NULL,
        CONSTRAINT UQ_solicitor_check_items_code UNIQUE (code));`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.solicitor_check_items','U') IS NOT NULL DROP TABLE dbo.solicitor_check_items;`);
  },
};
