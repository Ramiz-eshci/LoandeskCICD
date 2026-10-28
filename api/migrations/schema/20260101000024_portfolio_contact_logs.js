'use strict';

/**
 * Migration: Portfolio customer contact logs.
 *
 * Additive and idempotent. Each log is tied to the live loan/facility, its
 * source application, and the customer/applicant shown on the portfolio page.
 */

async function IX(db, ix, tbl, cols) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`);
}

module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.portfolio_contact_logs','U') IS NULL
      CREATE TABLE dbo.portfolio_contact_logs (
        log_id            INT IDENTITY(1,1) PRIMARY KEY,
        loan_id           INT NOT NULL,
        application_id    INT NOT NULL,
        applicant_id      INT NOT NULL,
        contact_date      DATE NOT NULL,
        person            NVARCHAR(200) NOT NULL,
        method            NVARCHAR(30) NOT NULL,
        contact_notes     NVARCHAR(MAX) NULL,
        followup_date     DATE NULL,
        outlook_reminder  BIT NOT NULL DEFAULT 0,
        outlook_event_id  NVARCHAR(200) NULL,
        followup_status   NVARCHAR(30) NOT NULL DEFAULT 'Pending',
        contact_outcome   NVARCHAR(50) NULL,
        flag_deleted      BIT NOT NULL DEFAULT 0,
        created_by        INT NULL,
        created_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by        INT NULL,
        updated_at        DATETIME2 NULL,
        deleted_on        DATETIME2 NULL,
        CONSTRAINT FK_pcl_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id),
        CONSTRAINT FK_pcl_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_pcl_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id),
        CONSTRAINT FK_pcl_created_by FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_pcl_updated_by FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
      );`);
    await IX(db, 'IX_pcl_app', 'portfolio_contact_logs', 'application_id, contact_date DESC');
    await IX(db, 'IX_pcl_loan', 'portfolio_contact_logs', 'loan_id, contact_date DESC');
    await IX(db, 'IX_pcl_customer', 'portfolio_contact_logs', 'applicant_id, contact_date DESC');
    await IX(db, 'IX_pcl_followup', 'portfolio_contact_logs', 'followup_date, followup_status');
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.portfolio_contact_logs','U') IS NOT NULL DROP TABLE dbo.portfolio_contact_logs;");
  },
};
