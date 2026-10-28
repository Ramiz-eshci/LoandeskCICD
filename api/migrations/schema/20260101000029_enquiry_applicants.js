'use strict';

/**
 * Migration: enquiry_applicants — the per-enquiry list of applicants / directors
 * (client PDF section 4). For an Individual enquiry there is one row (is_primary);
 * for a Company enquiry there may be one or more director / shareholder rows.
 * Idempotent.
 */

const AUDIT = `
  is_active    BIT NOT NULL DEFAULT 1,
  flag_deleted BIT NOT NULL DEFAULT 0,
  created_by   INT NULL,
  created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_by   INT NULL,
  updated_at   DATETIME2 NULL,
  deleted_on   DATETIME2 NULL`;

module.exports = {
  async up(db) {
    await db.raw(
      `IF OBJECT_ID('dbo.enquiry_applicants','U') IS NULL
       CREATE TABLE dbo.enquiry_applicants (
         enquiry_applicant_id INT IDENTITY(1,1) PRIMARY KEY,
         enquiry_id     INT NOT NULL,
         sort_order     INT NOT NULL DEFAULT 0,
         is_primary     BIT NOT NULL DEFAULT 0,
         full_name      NVARCHAR(200) NULL,
         dob            DATE NULL,
         nationality    NVARCHAR(80) NULL,
         address        NVARCHAR(400) NULL,
         time_at_address NVARCHAR(80) NULL,
         email          NVARCHAR(150) NULL,
         mobile         NVARCHAR(40) NULL,
         owns_home      BIT NULL,
         occupation     NVARCHAR(150) NULL,
         employer_name  NVARCHAR(200) NULL,
         business_address NVARCHAR(400) NULL,
         length_of_service NVARCHAR(80) NULL,
         relationship   NVARCHAR(120) NULL,
         shareholding_pct DECIMAL(6,2) NULL,
         prev_bridging  BIT NULL,
         prev_bridging_lender NVARCHAR(200) NULL,
         ${AUDIT},
         CONSTRAINT FK_enq_applicants_enq FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id)
       );`,
    );
    await db.raw(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_enq_applicants_enq')
       CREATE INDEX IX_enq_applicants_enq ON dbo.enquiry_applicants(enquiry_id);`,
    );
  },

  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.enquiry_applicants','U') IS NOT NULL DROP TABLE dbo.enquiry_applicants;`);
  },
};
