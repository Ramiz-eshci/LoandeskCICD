'use strict';

/**
 * Seeder: Rejection Reason master gets the reasons that used to be hard-coded
 * in the Application > Reject modal (28-09-2026).
 *
 * The Reject modal now reads the Rejection Reason master (active rows only), so
 * the reasons that existed only in the screen code are added here so no option
 * disappears. Reasons already covered by the base seed (Affordability,
 * Adverse credit history, LTV too high, Insufficient documentation) are not
 * duplicated. Idempotent: guarded by code AND name.
 */
const ROWS = [
  ['SECURITY_VALUE', 'Insufficient security value'],
  ['EXIT_STRATEGY', 'Unacceptable exit strategy'],
  ['KYC_AML', 'KYC / AML concern'],
  ['OUTSIDE_POLICY', 'Outside lending policy'],
];

module.exports = {
  async run(db) {
    for (const [code, name] of ROWS) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM rejection_reasons WHERE code = @p0 OR name = @p1)
           INSERT INTO rejection_reasons (code, name) VALUES (@p0, @p1);`,
        [code, name],
      );
    }
  },
};
