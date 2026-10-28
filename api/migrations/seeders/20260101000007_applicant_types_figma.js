'use strict';

/**
 * Seeder: applicant types to match the Enquiry Figma segmented control
 * (Individual · Company · Joint · Multi-Party). Adds the two missing codes
 * (Joint, Multi-Party). Idempotent by code.
 */
const TYPES = [
  { code: 'JOINT', name: 'Joint' },
  { code: 'MULTI_PARTY', name: 'Multi-Party' },
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
