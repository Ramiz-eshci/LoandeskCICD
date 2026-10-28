'use strict';

/**
 * Migration: portfolio control tables — fees, drawdowns, covenants.
 *
 * Without these, Portfolio is a viewer: fees are invisible (redemption quotes
 * assume £0), staged drawdowns can't be recorded or gated, and covenant
 * monitoring has nowhere to live. All three hang off loans(loan_id) so a
 * customer with several facilities keeps each facility's controls separate,
 * while the customer remains reachable via the loan's application.
 */

module.exports = {
  async up(db) {
    await db.raw(
      `IF OBJECT_ID('dbo.loan_fees','U') IS NULL
       CREATE TABLE dbo.loan_fees (
        fee_id      INT IDENTITY(1,1) PRIMARY KEY,
        loan_id     INT NOT NULL,
        fee_type    NVARCHAR(40) NOT NULL,
        amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
        due_date    DATE NULL,
        status      NVARCHAR(20) NOT NULL DEFAULT 'Due',
        notes       NVARCHAR(500) NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT FK_fee_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id));`,
    );
    await db.raw(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_fee_loan')
         CREATE INDEX IX_fee_loan ON dbo.loan_fees(loan_id);`,
    );

    await db.raw(
      `IF OBJECT_ID('dbo.loan_drawdowns','U') IS NULL
       CREATE TABLE dbo.loan_drawdowns (
        drawdown_id INT IDENTITY(1,1) PRIMARY KEY,
        loan_id     INT NOT NULL,
        drawdown_no INT NOT NULL DEFAULT 1,
        drawn_on    DATE NOT NULL,
        amount      DECIMAL(18,2) NOT NULL,
        notes       NVARCHAR(500) NULL,
        status      NVARCHAR(20) NOT NULL DEFAULT 'Released',
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT FK_dd_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id));`,
    );
    await db.raw(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_dd_loan')
         CREATE INDEX IX_dd_loan ON dbo.loan_drawdowns(loan_id);`,
    );

    await db.raw(
      `IF OBJECT_ID('dbo.loan_covenants','U') IS NULL
       CREATE TABLE dbo.loan_covenants (
        covenant_id   INT IDENTITY(1,1) PRIMARY KEY,
        loan_id       INT NOT NULL,
        name          NVARCHAR(200) NOT NULL,
        covenant_type NVARCHAR(40) NULL,
        frequency     NVARCHAR(40) NULL,
        next_due      DATE NULL,
        status        NVARCHAR(20) NOT NULL DEFAULT 'Upcoming',
        notes         NVARCHAR(500) NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL,
        CONSTRAINT FK_cov_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id));`,
    );
    await db.raw(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_cov_loan')
         CREATE INDEX IX_cov_loan ON dbo.loan_covenants(loan_id);`,
    );
  },

  async down(db) {
    for (const [tbl, fk, ix] of [
      ['loan_fees', 'FK_fee_loan', 'IX_fee_loan'],
      ['loan_drawdowns', 'FK_dd_loan', 'IX_dd_loan'],
      ['loan_covenants', 'FK_cov_loan', 'IX_cov_loan'],
    ]) {
      await db.raw(
        `IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${fk}')
           ALTER TABLE dbo.${tbl} DROP CONSTRAINT ${fk};`,
      );
      await db.raw(
        `IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}')
           DROP INDEX ${ix} ON dbo.${tbl};`,
      );
      await db.raw(
        `IF OBJECT_ID('dbo.${tbl}','U') IS NOT NULL DROP TABLE dbo.${tbl};`,
      );
    }
  },
};
