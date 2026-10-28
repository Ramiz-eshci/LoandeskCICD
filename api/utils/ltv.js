'use strict';

/**
 * LTV rules - client 17-10-2026 (replaces the 16-10-2026 "combined LTV everywhere" rule):
 *
 *   LTV       = our gross loan ÷ total security value × 100          <- shown everywhere
 *               (once an indicative is sent, screens show the LTV entered on the indicative)
 *   Total LTV = (our loan + other charges on the same properties, e.g. the 1st charge
 *               ahead of a 2nd-charge loan) ÷ total security value × 100
 *               <- shown ONLY on the Summary tab (Enquiry, Application, Underwriting Case
 *                  Summary); worked out when the enquiry is added / edited.
 *
 *   e.g. property 500,000, 1st charge 100,000, gross 100,000 -> LTV 20%, Total LTV 40%
 *        property 500,000, no charge,           gross 100,000 -> LTV 20%, Total LTV 20%
 *
 * A security row may be an enquiry row (estimated_value / value, charge_type,
 * charge_amount, existing_charge) or an application_security row (estimated_value,
 * charge_type, charge_amount, outstanding_loan - "other securities" keep their existing
 * charge in outstanding_loan).
 */
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const clamp = (v) => (v > 999.999 ? 999.999 : v); // DECIMAL(6,3)
const r2 = (v) => Math.round(v * 100) / 100;

/** Debt secured AHEAD of / alongside us on one property (2nd charge -> the charge in front). */
function otherChargeOn(s) {
  if (!s || typeof s !== 'object') return 0;
  const is2nd = /^\s*2nd/i.test(String(s.charge_type || ''));
  if (is2nd) return num(s.charge_amount) || num(s.outstanding_loan) || num(s.existing_charge);
  // Older rows with no charge type: an existing charge typed on its own still counts.
  if (s.charge_amount == null && s.outstanding_loan == null) return num(s.existing_charge);
  return 0;
}
const valueOf = (s) => (s && typeof s === 'object' ? num(s.estimated_value != null ? s.estimated_value : s.value) : 0);

/**
 * @param {number} gross        our gross loan
 * @param {object[]} securities every security (main first), enquiry or application shape
 * @returns {{ our: number|null, total: number|null, value: number, charges: number }}
 *          our = LTV (loan only), total = Total LTV (loan + other charges).
 */
function ltvPair(gross, securities) {
  const list = (Array.isArray(securities) ? securities : []).filter(Boolean);
  const value = list.reduce((a, s) => a + valueOf(s), 0);
  const charges = list.reduce((a, s) => a + otherChargeOn(s), 0);
  const g = num(gross);
  if (!value || !g) return { our: null, total: null, value, charges };
  // Client 17-10-2026: LTV = our loan only; the charges ahead go in Total LTV.
  const our = clamp(r2((g / value) * 100));
  const total = clamp(r2(((g + charges) / value) * 100));
  return { our, total, value, charges };
}

/**
 * Client 17-10-2026: TOTAL LTV - shown ONLY on the Summary tab of Enquiry, Application and
 * Underwriting (Case Summary). Every other LTV on screen stays as it is.
 *   Total LTV = (our gross loan + other charges on the securities, e.g. the 1st charge
 *               ahead of a 2nd-charge loan) ÷ total security value × 100
 *   e.g. property 500,000, 1st charge 100,000, gross 100,000 -> 40%
 *        property 500,000, no charge,           gross 100,000 -> 20%
 * @returns {number|null} null when there is no gross loan or no security value.
 */
function totalLtv(gross, securities) {
  const list = (Array.isArray(securities) ? securities : []).filter(Boolean);
  const value = list.reduce((a, s) => a + valueOf(s), 0);
  const charges = list.reduce((a, s) => a + otherChargeOn(s), 0);
  const g = num(gross);
  if (!value || !g) return null;
  return clamp(r2(((g + charges) / value) * 100));
}

/**
 * Re-compute an application's ltv_pct (LTV) + total_ltv_pct (Total LTV) from its own amount
 * and security rows. `db` is config/database. Returns the pair (or null on no data).
 */
async function refreshApplicationLtv(db, applicationId) {
  const a = await db.query('SELECT amount_requested FROM applications WHERE application_id = @p0', [applicationId]);
  if (!a.length) return null;
  const secs = await db.query(
    `SELECT estimated_value, charge_type, charge_amount, outstanding_loan
       FROM application_security WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id`, [applicationId]);
  const p = ltvPair(a[0].amount_requested, secs);
  if (p.our == null) return null;
  await db.query('UPDATE applications SET ltv_pct = @p1, total_ltv_pct = @p2 WHERE application_id = @p0', [applicationId, p.our, p.total]);
  return p;
}

module.exports = { ltvPair, totalLtv, otherChargeOn, refreshApplicationLtv };
