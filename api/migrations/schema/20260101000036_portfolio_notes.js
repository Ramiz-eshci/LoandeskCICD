'use strict';

/**
 * Migration: portfolio_notes — free-text portfolio-manager notes per facility,
 * shown in the "Portfolio Notes" panel of the contact-log / schedule view.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.portfolio_notes','U') IS NULL
      CREATE TABLE dbo.portfolio_notes (
        note_id     INT IDENTITY(1,1) PRIMARY KEY,
        loan_id     INT NOT NULL,
        note        NVARCHAR(2000) NOT NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT FK_portfolio_notes_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id));`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_portfolio_notes_loan')
      CREATE INDEX IX_portfolio_notes_loan ON dbo.portfolio_notes(loan_id);`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.portfolio_notes','U') IS NOT NULL DROP TABLE dbo.portfolio_notes;`);
  },
};
