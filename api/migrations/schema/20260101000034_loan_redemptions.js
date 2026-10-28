'use strict';

module.exports = {
  async up(db) {
    await db.raw(
      `IF OBJECT_ID('dbo.loan_redemptions','U') IS NULL
       CREATE TABLE dbo.loan_redemptions (
        redemption_id INT IDENTITY(1,1) PRIMARY KEY,
        loan_id INT NOT NULL,
        application_id INT NOT NULL,
        redemption_date DATE NOT NULL,
        principal_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
        accrued_interest DECIMAL(18,2) NOT NULL DEFAULT 0,
        exit_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
        other_fees DECIMAL(18,2) NOT NULL DEFAULT 0,
        credits DECIMAL(18,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
        status NVARCHAR(20) NOT NULL DEFAULT 'Quoted',
        document_id INT NULL,
        payment_id INT NULL,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        completed_by INT NULL,
        completed_at DATETIME2 NULL,
        CONSTRAINT FK_red_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id),
        CONSTRAINT FK_red_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_red_doc FOREIGN KEY (document_id) REFERENCES dbo.application_documents(app_document_id),
        CONSTRAINT FK_red_pay FOREIGN KEY (payment_id) REFERENCES dbo.loan_payments(payment_id));`,
    );
    await db.raw(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_red_loan')
         CREATE INDEX IX_red_loan ON dbo.loan_redemptions(loan_id, redemption_date DESC);`,
    );
  },

  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.loan_redemptions','U') IS NOT NULL DROP TABLE dbo.loan_redemptions;`);
  },
};
