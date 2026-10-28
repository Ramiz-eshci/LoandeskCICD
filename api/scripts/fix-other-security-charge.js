'use strict';
/**
 * One-off (14-10-2026): "other security" rows on applications were saved with a
 * charge GUESSED from existing_charge, ignoring the 1st / 2nd charge selected on the
 * enquiry's Security tab (e.g. a 2nd-charge security showing as 1st in the
 * Underwriting valuation dropdown). This corrects those rows from the enquiry.
 *
 *   node scripts/fix-other-security-charge.js          # dry run - prints changes only
 *   node scripts/fix-other-security-charge.js --apply  # writes the changes
 */
require('dotenv').config();
const db = require('../config/database');

const APPLY = process.argv.includes('--apply');
const addrKey = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const chgSel = (ct) => { const s = String(ct || '').trim().toLowerCase(); return s.startsWith('2nd') ? '2nd' : (s.startsWith('1st') ? '1st' : ''); };

(async () => {
  const rows = await db.query(
    `SELECT s.security_id, s.application_id, s.property_address, s.charge_type, e.additional_securities
       FROM application_security s
       JOIN applications a ON a.application_id = s.application_id
       JOIN enquiries e    ON e.enquiry_id = a.enquiry_id
      WHERE s.flag_deleted = 0 AND s.added_value = 'OTHER_SECURITY' AND e.additional_securities IS NOT NULL`);
  let changed = 0;
  for (const r of rows) {
    let secs = [];
    try { secs = JSON.parse(r.additional_securities) || []; } catch (_) { continue; }
    const m = (Array.isArray(secs) ? secs : []).find((x) => x && addrKey(x.address || x.description) === addrKey(r.property_address));
    const ct = m ? chgSel(m.charge_type) : '';
    if (!ct) continue;
    const label = ct; // '1st' / '2nd' - same as the main security + application edit dropdown
    if (String(r.charge_type || '') === label) continue;
    changed += 1;
    console.log(`${APPLY ? '[fix]' : '[dry-run]'} app ${r.application_id} security ${r.security_id} "${r.property_address}": ${r.charge_type || '-'} -> ${label}`);
    if (APPLY) await db.query('UPDATE application_security SET charge_type = @p1 WHERE security_id = @p0', [r.security_id, label]);
  }
  console.log(`checked ${rows.length}, ${APPLY ? 'updated' : 'would update'} ${changed}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
