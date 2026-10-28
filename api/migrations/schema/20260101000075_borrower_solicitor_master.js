'use strict';

/**
 * Migration: Borrower's Solicitor master (client 15-10-2026).
 *   borrower_solicitors              new master - the 5 fields of section 5 of the application
 *                                    form: firm_name (Borrower's solicitor / firm name),
 *                                    contact_name, address, telephone, email. Picked on the New
 *                                    Enquiry popup (single rep), editable / addable from there and
 *                                    from Masters > Borrower's Solicitor. Kept apart from the
 *                                    lender-side `solicitors` master used by underwriting.
 *   enquiries.borrower_solicitor_id  the row picked. The borrower_sol_* columns stay as the
 *                                    snapshot every downstream reader (underwriting step 4,
 *                                    application form, credit paper) already uses; the server
 *                                    fills them from the master.
 * Additive + idempotent. Permissions / menu: seeder 20260101000071.
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
    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitors','U') IS NULL CREATE TABLE dbo.borrower_solicitors (
        borrower_solicitor_id INT IDENTITY(1,1) PRIMARY KEY,
        code         NVARCHAR(30)  NOT NULL,
        firm_name    NVARCHAR(150) NOT NULL,
        contact_name NVARCHAR(150) NULL,
        address      NVARCHAR(500) NULL,
        telephone    NVARCHAR(30)  NULL,
        email        NVARCHAR(150) NULL,
        ${AUDIT},
        CONSTRAINT UQ_borrower_solicitors_code UNIQUE (code));`);
    await db.raw(`IF COL_LENGTH('dbo.enquiries','borrower_solicitor_id') IS NULL ALTER TABLE dbo.enquiries ADD borrower_solicitor_id INT NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.enquiries','borrower_solicitor_id') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN borrower_solicitor_id;`);
    await db.raw(`IF OBJECT_ID('dbo.borrower_solicitors','U') IS NOT NULL DROP TABLE dbo.borrower_solicitors;`);
  },
};
