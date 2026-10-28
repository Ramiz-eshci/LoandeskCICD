'use strict';

/**
 * Migration: Est. LTV now counts 2nd-charge amounts as well as outstanding loans
 * (client 30-09-2026: 400,000 value, 100,000 outstanding + 100,000 2nd charge = 50%).
 * Re-runs seeder 058, which recomputes every enquiry's stored ltv_pct with
 * enquiry.service computeCombinedLtv(). Idempotent; down() is a no-op (the old
 * values are not kept - restore from a DB backup if needed).
 */
const seeder = require('../seeders/20260101000058_enquiry_ltv_net_recalc');

module.exports = {
  async up(db) { await seeder.run(db); },
  async down() { /* no-op */ },
};
