'use strict';

/**
 * Module-4 enhancement: split "Send Offer" into Indicatives + Offer, both
 * versioned (back-and-forth negotiation) and audited, offer emailed with 2 PDFs.
 *
 *  - enquiry_indicatives : one row per indicative-quote version (inputs + calc)
 *  - enquiry_offers      : one row per official-offer version (letter fields + PDFs + email state)
 *  - enquiries           : convenience pointers + timestamps
 *
 * Additive & idempotent. Follows the standard IDENTITY-PK / audit-column convention.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.enquiry_indicatives','U') IS NULL CREATE TABLE dbo.enquiry_indicatives (
        enquiry_indicative_id INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_id   INT NOT NULL,
        version_no   INT NOT NULL DEFAULT 1,
        inputs_json  NVARCHAR(MAX) NULL,
        calc_json    NVARCHAR(MAX) NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'Draft',   -- Draft | Sent | Superseded
        document_id  INT NULL,
        sent_at      DATETIME2 NULL,
        sent_by      INT NULL,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        CONSTRAINT FK_enq_ind_enquiry FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id));`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_enq_ind_enquiry')
        CREATE INDEX IX_enq_ind_enquiry ON dbo.enquiry_indicatives(enquiry_id, version_no);`);

    await db.raw(`IF OBJECT_ID('dbo.enquiry_offers','U') IS NULL CREATE TABLE dbo.enquiry_offers (
        enquiry_offer_id INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_id    INT NOT NULL,
        version_no    INT NOT NULL DEFAULT 1,
        offer_json    NVARCHAR(MAX) NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'Draft',  -- Draft | Sent | Accepted | Superseded | Withdrawn
        offer_pdf_doc_id INT NULL,
        app_form_doc_id  INT NULL,
        valid_until   DATE NULL,
        email_status  VARCHAR(20) NULL,                      -- Sent | Failed | NULL
        email_to      NVARCHAR(200) NULL,
        email_cc      NVARCHAR(400) NULL,
        email_subject NVARCHAR(300) NULL,
        email_message_id NVARCHAR(300) NULL,
        email_error   NVARCHAR(600) NULL,
        sent_at       DATETIME2 NULL,
        sent_by       INT NULL,
        accepted_at   DATETIME2 NULL,
        flag_deleted  BIT NOT NULL DEFAULT 0,
        created_by    INT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by    INT NULL,
        updated_at    DATETIME2 NULL,
        CONSTRAINT FK_enq_off_enquiry FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id));`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_enq_off_enquiry')
        CREATE INDEX IX_enq_off_enquiry ON dbo.enquiry_offers(enquiry_id, version_no);`);

    const cols = [
      ['indicative_sent_at', 'DATETIME2'],
      ['offer_accepted_at', 'DATETIME2'],
      ['current_indicative_id', 'INT'],
      ['current_offer_id', 'INT'],
    ];
    for (const [c, t] of cols) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NULL ALTER TABLE dbo.enquiries ADD ${c} ${t} NULL;`);
    }
  },
  async down(db) {
    for (const c of ['indicative_sent_at', 'offer_accepted_at', 'current_indicative_id', 'current_offer_id']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
    await db.raw(`IF OBJECT_ID('dbo.enquiry_offers','U') IS NOT NULL DROP TABLE dbo.enquiry_offers;`);
    await db.raw(`IF OBJECT_ID('dbo.enquiry_indicatives','U') IS NOT NULL DROP TABLE dbo.enquiry_indicatives;`);
  },
};
