'use strict';

/**
 * Migration: backfill application security details from the enquiry (client 15-10-2026).
 * Applications converted before the convert fix showed less than the enquiry:
 *   - main security: Charge Amount (2nd charge) was never copied;
 *   - other securities: only address / value / charge were copied - postcode, type, tenure,
 *     years, GDV, owns, purchase price / date, repaid, lender, map link were blank.
 * Fills ONLY empty (NULL) columns from the source enquiry, matching other securities by
 * address. Never overwrites a value someone typed on the application. Idempotent;
 * down() is a no-op (data only).
 */
const addrKey = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const n = (v) => { const x = Number(v); return v === '' || v == null || !Number.isFinite(x) ? null : x; };
const b = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'Yes' ? 1
  : (v === false || v === 0 || v === '0' || v === 'false' || v === 'No' ? 0 : null));
const d = (v) => { const t = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const s = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const is2nd = (ct) => /^\s*2nd/i.test(String(ct || ''));

module.exports = {
  async up(db) {
    // 1) main security charge amount
    await db.query(
      `UPDATE s SET charge_amount = e.charge_amount
         FROM application_security s
         JOIN applications a ON a.application_id = s.application_id
         JOIN enquiries e ON e.enquiry_id = a.enquiry_id
        WHERE s.flag_deleted = 0 AND s.charge_amount IS NULL AND e.charge_amount IS NOT NULL
          AND ISNULL(s.added_value, '') <> 'OTHER_SECURITY'
          AND LEFT(LTRIM(ISNULL(s.charge_type, '')), 3) = '2nd'
          AND s.security_id = (SELECT TOP 1 s2.security_id FROM application_security s2
                                WHERE s2.application_id = s.application_id AND s2.flag_deleted = 0 ORDER BY s2.security_id)`);

    // 2) other securities
    const rows = await db.query(
      `SELECT s.security_id, s.property_address, s.charge_type, s.charge_amount, s.outstanding_loan,
              s.postcode, s.property_type, s.tenure, s.tenure_years, s.gdv, s.owns_property, s.purchase_price,
              s.purchase_date, s.repaid_on_completion, s.lender, s.map_link, e.additional_securities
         FROM application_security s
         JOIN applications a ON a.application_id = s.application_id
         JOIN enquiries e ON e.enquiry_id = a.enquiry_id
        WHERE s.flag_deleted = 0 AND s.added_value = 'OTHER_SECURITY' AND e.additional_securities IS NOT NULL`);
    for (const r of rows) {
      let secs = [];
      try { secs = JSON.parse(r.additional_securities) || []; } catch (_) { continue; }
      const m = (Array.isArray(secs) ? secs : []).find((x) => x && addrKey(x.address || x.description) === addrKey(r.property_address));
      if (!m) continue;
      const fill = {};
      const put = (col, v) => { if (r[col] == null && v != null) fill[col] = v; };
      put('postcode', s(m.postcode, 20));
      put('property_type', s(m.property_type || m.security_type, 60));
      put('tenure', s(m.tenure, 30));
      put('tenure_years', n(m.tenure_years));
      put('gdv', n(m.gdv));
      put('owns_property', b(m.owns_property));
      put('purchase_price', n(m.purchase_price));
      put('purchase_date', d(m.purchase_date));
      put('repaid_on_completion', b(m.repaid_on_completion));
      put('lender', s(m.lender, 150));
      put('map_link', s(m.map_link, 500));
      if (is2nd(r.charge_type) && r.charge_amount == null) {
        const amt = n(m.charge_amount);
        if (amt != null) {
          fill.charge_amount = amt;
          // older converts parked the 2nd-charge amount in outstanding_loan
          if (r.outstanding_loan != null && Number(r.outstanding_loan) === amt) fill.outstanding_loan = n(m.outstanding_loan);
        }
      }
      const cols = Object.keys(fill);
      if (!cols.length) continue;
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `UPDATE application_security SET ${cols.map((c, i) => `${c} = @p${i + 1}`).join(', ')}, updated_at = SYSUTCDATETIME()
          WHERE security_id = @p0`, [r.security_id, ...cols.map((c) => fill[c])]);
    }
  },
  async down() { /* data backfill only */ },
};
