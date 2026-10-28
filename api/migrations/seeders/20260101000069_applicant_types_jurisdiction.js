'use strict';

/**
 * Seeder: jurisdiction-specific applicant types (client 09-10-2026).
 * The offer letter now has four legally-distinct templates, chosen by
 * jurisdiction (England/Wales vs Scotland) and borrower kind (Individual vs
 * Limited Company). These four show in the Enquiry intake dropdown in place of
 * the old Individual/Company. Legacy Individual/Company rows are KEPT — KYC
 * check items and historic enquiries/applications reference them. Idempotent
 * by code.
 */
const TYPES = [
  { code: 'EW_IND',   name: 'England/Wales Individuals' },
  { code: 'EW_LTD',   name: 'England/Wales Limited Companies' },
  { code: 'SCOT_IND', name: 'Scotland Individuals' },
  { code: 'SCOT_LTD', name: 'Scotland Limited Companies' },
];
module.exports = {
  async run(db) {
    for (const t of TYPES) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM applicant_types WHERE code = @p0)
           INSERT INTO applicant_types (code, name) VALUES (@p0, @p1);`,
        [t.code, t.name],
      );
    }
  },
};
