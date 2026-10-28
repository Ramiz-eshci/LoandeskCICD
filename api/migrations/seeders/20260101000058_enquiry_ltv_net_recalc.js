'use strict';

/**
 * Seeder: recompute every enquiry's stored Est. LTV with the current rule in
 * enquiry.service computeCombinedLtv() (29-09-2026 13:28):
 *   Σ (outstanding loans + 2nd-charge amounts) ÷ Σ property values × 100 (30-09-2026)
 * Idempotent: only rows whose value changes are updated.
 */

const { computeCombinedLtv } = require('../../services/enquiry.service');

module.exports = {
  async run(db) {
    const rows = await db.query(
      `SELECT enquiry_id, amount_requested, estimated_value, outstanding_loan, charge_type, charge_amount,
              additional_securities, ltv_pct
         FROM enquiries`);
    let changed = 0;
    for (const r of rows) {
      let secs = [];
      try { secs = r.additional_securities ? JSON.parse(r.additional_securities) : []; } catch (_) { secs = []; }
      const ltv = computeCombinedLtv(r, secs);
      const cur = r.ltv_pct == null ? null : Number(r.ltv_pct);
      if ((ltv == null && cur == null) || (ltv != null && cur != null && Math.abs(ltv - cur) < 0.001)) continue;
      // eslint-disable-next-line no-await-in-loop
      await db.query('UPDATE enquiries SET ltv_pct = @p1 WHERE enquiry_id = @p0', [r.enquiry_id, ltv]);
      changed += 1;
    }
    console.log(`  enquiry LTV recalculated: ${changed} of ${rows.length} enquiries changed`);
  },
};
