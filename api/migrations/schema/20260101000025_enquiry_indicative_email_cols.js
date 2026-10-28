'use strict';

/** Email-tracking columns on enquiry_indicatives (indicative is now emailed too). Additive & idempotent. */
module.exports = {
  async up(db) {
    const cols = [
      ['email_status', 'VARCHAR(20)'],
      ['email_to', 'NVARCHAR(200)'],
      ['email_cc', 'NVARCHAR(400)'],
      ['email_subject', 'NVARCHAR(300)'],
      ['email_error', 'NVARCHAR(600)'],
    ];
    for (const [c, t] of cols) {
      await db.raw(`IF COL_LENGTH('dbo.enquiry_indicatives','${c}') IS NULL ALTER TABLE dbo.enquiry_indicatives ADD ${c} ${t} NULL;`);
    }
  },
  async down(db) {
    for (const c of ['email_status', 'email_to', 'email_cc', 'email_subject', 'email_error']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiry_indicatives','${c}') IS NOT NULL ALTER TABLE dbo.enquiry_indicatives DROP COLUMN ${c};`);
    }
  },
};
