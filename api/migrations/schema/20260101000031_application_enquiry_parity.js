'use strict';

/**
 * Migration: give the Application module the same field set as an Enquiry.
 *
 * The enquiry captured 34 fields; the application row shared only 8 of them.
 * The other 26 (borrower identity, property and security detail) had nowhere
 * to live on the application side, so Application Detail could neither show
 * nor edit them.
 *
 * These are NOT duplicates of the enquiry. The enquiry is the original
 * point-in-time record of what was asked for and must not change once
 * converted (offers and PDFs already went out against it). The application
 * owns its own working copy, which caseworkers may correct — a borrower name
 * can legitimately change between enquiry and completion.
 *
 * Fields are placed where they belong rather than flattened onto `applications`:
 *   applicants            -> company_reg_no
 *   application_security  -> the property / security block
 *   applications          -> lead_source, broker_name, summary
 *
 * Additive and idempotent (COL_LENGTH guards). The backfill only writes where
 * the target is still NULL, so re-running never overwrites an edit.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

/** application_security columns mirroring the enquiry's property block. */
const SECURITY_COLS = [
  ['postcode', 'postcode NVARCHAR(20) NULL'],
  ['property_type', 'property_type NVARCHAR(60) NULL'],
  ['tenure', 'tenure NVARCHAR(30) NULL'],
  ['tenure_years', 'tenure_years INT NULL'],
  ['gdv', 'gdv DECIMAL(18,2) NULL'],
  ['owns_property', 'owns_property BIT NULL'],
  ['purchase_price', 'purchase_price DECIMAL(18,2) NULL'],
  ['purchase_date', 'purchase_date DATE NULL'],
  ['outstanding_loan', 'outstanding_loan DECIMAL(18,2) NULL'],
  ['repaid_on_completion', 'repaid_on_completion BIT NULL'],
  ['lender', 'lender NVARCHAR(150) NULL'],
  ['added_value', 'added_value NVARCHAR(500) NULL'],
];

const APPLICATION_COLS = [
  ['lead_source', 'lead_source NVARCHAR(100) NULL'],
  ['broker_name', 'broker_name NVARCHAR(200) NULL'],
  ['summary', 'summary NVARCHAR(MAX) NULL'],
  ['requested_completion_date', 'requested_completion_date DATE NULL'],
];

module.exports = {
  async up(db) {
    /* ---------- borrower ---------- */
    await addCol(db, 'applicants', 'company_reg_no', 'company_reg_no NVARCHAR(50) NULL');

    /* ---------- property / security ---------- */
    for (const [col, ddl] of SECURITY_COLS) await addCol(db, 'application_security', col, ddl);

    /* ---------- application-level ---------- */
    for (const [col, ddl] of APPLICATION_COLS) await addCol(db, 'applications', col, ddl);

    /* ---------- backfill from the originating enquiry ---------- */
    // Applications converted before this migration have these fields only on
    // their enquiry. Seed them once so existing cases are not blank; the
    // NULL guards mean a second run cannot clobber a later edit.
    await db.raw(`
      UPDATE a
         SET a.lead_source = COALESCE(a.lead_source, e.lead_source),
             a.broker_name = COALESCE(a.broker_name, e.broker_name),
             a.summary     = COALESCE(a.summary, e.summary),
             a.requested_completion_date = COALESCE(a.requested_completion_date, e.requested_completion_date)
        FROM dbo.applications a
        JOIN dbo.enquiries e ON e.enquiry_id = a.enquiry_id
       WHERE a.enquiry_id IS NOT NULL;`);

    await db.raw(`
      UPDATE ap
         SET ap.company_reg_no = COALESCE(ap.company_reg_no, e.company_reg_no)
        FROM dbo.applicants ap
        JOIN dbo.application_applicants aa ON aa.applicant_id = ap.applicant_id
        JOIN dbo.applications a ON a.application_id = aa.application_id
        JOIN dbo.enquiries e ON e.enquiry_id = a.enquiry_id
       WHERE a.enquiry_id IS NOT NULL;`);

    // A security row may not exist yet for older applications - create one from
    // the enquiry before backfilling, otherwise there is nothing to update.
    await db.raw(`
      INSERT INTO dbo.application_security (application_id, property_address, estimated_value, charge_type, created_by)
      SELECT a.application_id, e.property_address, e.estimated_value, e.charge_type, a.created_by
        FROM dbo.applications a
        JOIN dbo.enquiries e ON e.enquiry_id = a.enquiry_id
       WHERE a.enquiry_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM dbo.application_security s WHERE s.application_id = a.application_id);`);

    await db.raw(`
      UPDATE s
         SET s.postcode             = COALESCE(s.postcode, e.postcode),
             s.property_type        = COALESCE(s.property_type, e.property_type),
             s.tenure               = COALESCE(s.tenure, e.tenure),
             s.tenure_years         = COALESCE(s.tenure_years, e.tenure_years),
             s.gdv                  = COALESCE(s.gdv, e.gdv),
             s.owns_property        = COALESCE(s.owns_property, e.owns_property),
             s.purchase_price       = COALESCE(s.purchase_price, e.purchase_price),
             s.purchase_date        = COALESCE(s.purchase_date, e.purchase_date),
             s.outstanding_loan     = COALESCE(s.outstanding_loan, e.outstanding_loan),
             s.repaid_on_completion = COALESCE(s.repaid_on_completion, e.repaid_on_completion),
             s.lender               = COALESCE(s.lender, e.lender),
             s.added_value          = COALESCE(s.added_value, e.added_value),
             s.property_address     = COALESCE(s.property_address, e.property_address),
             s.estimated_value      = COALESCE(s.estimated_value, e.estimated_value),
             s.charge_type          = COALESCE(s.charge_type, e.charge_type)
        FROM dbo.application_security s
        JOIN dbo.applications a ON a.application_id = s.application_id
        JOIN dbo.enquiries e ON e.enquiry_id = a.enquiry_id
       WHERE a.enquiry_id IS NOT NULL;`);
  },

  async down(db) {
    for (const [col] of APPLICATION_COLS) await dropCol(db, 'applications', col);
    for (const [col] of SECURITY_COLS) await dropCol(db, 'application_security', col);
    await dropCol(db, 'applicants', 'company_reg_no');
  },
};
