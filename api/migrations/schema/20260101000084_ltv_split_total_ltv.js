'use strict';

/**
 * Migration: LTV / Total LTV split (client 17-10-2026) - data only, no schema change.
 *
 *   ltv_pct       = our loan ÷ total security value            (shown everywhere)
 *   total_ltv_pct = (our loan + other charges) ÷ security value (Summary tab only)
 *
 * Until now ltv_pct held the combined figure (16-10-2026 rule) and total_ltv_pct was NULL,
 * so a 100,000 2nd-charge loan behind a 100,000 1st charge on a 500,000 property showed
 * "LTV 40%" instead of "LTV 20% / Total LTV 40%". Re-computes:
 *   - every enquiry: ltv_pct + total_ltv_pct from its typed amount and securities
 *   - applications whose LTV did NOT come from an indicative / offer (no enquiry, or the
 *     enquiry never had an indicative): ltv_pct + total_ltv_pct from their own securities.
 *     Applications that carry the indicative's LTV keep it (that LTV is what was entered).
 * Idempotent. down() is a no-op (the old combined figures are not restored).
 */
const { ltvPair } = require('../../utils/ltv');

module.exports = {
  async up(db) {
    const enqs = await db.query(
      `SELECT enquiry_id, amount_requested, estimated_value, charge_type, charge_amount, outstanding_loan, additional_securities
         FROM enquiries WHERE flag_deleted = 0`);
    for (const e of enqs) {
      let secs = [];
      try { secs = e.additional_securities ? JSON.parse(e.additional_securities) : []; } catch (_) { secs = []; }
      const p = ltvPair(e.amount_requested, [e, ...(Array.isArray(secs) ? secs : [])]);
      if (p.our == null) continue;
      await db.query('UPDATE enquiries SET ltv_pct = @p1, total_ltv_pct = @p2 WHERE enquiry_id = @p0', [e.enquiry_id, p.our, p.total]);
    }

    const apps = await db.query(
      `SELECT a.application_id, a.amount_requested FROM applications a
        WHERE a.flag_deleted = 0
          AND (a.enquiry_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM enquiry_indicatives i WHERE i.enquiry_id = a.enquiry_id AND i.flag_deleted = 0))`);
    for (const a of apps) {
      const secs = await db.query(
        `SELECT estimated_value, charge_type, charge_amount, outstanding_loan
           FROM application_security WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id`, [a.application_id]);
      const p = ltvPair(a.amount_requested, secs);
      if (p.our == null) continue;
      await db.query('UPDATE applications SET ltv_pct = @p1, total_ltv_pct = @p2 WHERE application_id = @p0', [a.application_id, p.our, p.total]);
    }
  },
  async down() { /* data correction only - nothing to undo */ },
};
