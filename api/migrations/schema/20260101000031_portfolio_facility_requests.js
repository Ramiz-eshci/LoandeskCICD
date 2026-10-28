'use strict';

async function IX(db, ix, tbl, cols) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`);
}

module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.portfolio_facility_requests','U') IS NULL
      CREATE TABLE dbo.portfolio_facility_requests (
        request_id           INT IDENTITY(1,1) PRIMARY KEY,
        loan_id              INT NOT NULL,
        request_type         NVARCHAR(30) NOT NULL,
        effective_date       DATE NOT NULL,
        current_maturity     DATE NULL,
        proposed_maturity    DATE NULL,
        new_amount           DECIMAL(18,2) NULL,
        revised_rate_pct     DECIMAL(6,3) NULL,
        reason               NVARCHAR(MAX) NULL,
        status               NVARCHAR(30) NOT NULL DEFAULT 'Credit Review',
        flag_deleted         BIT NOT NULL DEFAULT 0,
        created_by           INT NULL,
        created_at           DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by           INT NULL,
        updated_at           DATETIME2 NULL,
        CONSTRAINT FK_pfr_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id),
        CONSTRAINT FK_pfr_created_by FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_pfr_updated_by FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
      );`);
    await IX(db, 'IX_pfr_loan', 'portfolio_facility_requests', 'loan_id, created_at DESC');
    await IX(db, 'IX_pfr_status', 'portfolio_facility_requests', 'status, effective_date');
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.portfolio_facility_requests','U') IS NOT NULL DROP TABLE dbo.portfolio_facility_requests;");
  },
};
