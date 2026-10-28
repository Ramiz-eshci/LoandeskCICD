'use strict';

/**
 * Migration: application module changes (client 15-10-2026).
 *
 *  1. ONE LTV rule (utils/ltv.js): ltv_pct = OUR loan's LTV (our gross ÷ security value);
 *     total_ltv_pct = incl. other charges on the same properties (NULL when none).
 *     Adds total_ltv_pct to enquiries + applications and re-computes both for existing rows
 *     (until now ltv_pct was sometimes our LTV and sometimes the total).
 *  2. application_security.charge_amount - the existing charge in front of a 2nd-charge
 *     security (was missing; other securities lost their 2nd-charge amount on convert).
 *  3. Application status label: DRAFT is shown as "Awaiting Initial Review" (a converted
 *     deal waiting for its first credit review before underwriting - "Draft" misled).
 *  4. Application status catch-up: cases already moved to Portfolio still said "Credit
 *     Review". Completed cases -> COMPLETED, accepted in underwriting but app still at
 *     Draft / Submitted -> UNDERWRITING, committee-approved -> APPROVED, closed /
 *     rejected cases -> DECLINED. (Forward updates are now made by underwriting.service.)
 *
 * Additive + idempotent. down() drops the new columns and restores the "Draft" name;
 * the data corrections are not reversed.
 */
const { ltvPair } = require('../../utils/ltv');

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'enquiries', 'total_ltv_pct', 'total_ltv_pct DECIMAL(6,3) NULL');
    await addCol(db, 'applications', 'total_ltv_pct', 'total_ltv_pct DECIMAL(6,3) NULL');
    await addCol(db, 'application_security', 'charge_amount', 'charge_amount DECIMAL(18,2) NULL');

    await db.raw(`UPDATE application_statuses SET name = 'Awaiting Initial Review' WHERE code = 'DRAFT';`);

    // ---- status catch-up from the underwriting case ----
    const sid = async (code) => {
      const r = await db.query('SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code = @p0', [code]);
      return r[0] ? r[0].id : null;
    };
    const completed = await sid('COMPLETED');
    const approved = await sid('APPROVED');
    const declined = await sid('DECLINED');
    if (completed) {
      await db.query(
        `UPDATE a SET application_status_id = @p0, updated_at = SYSUTCDATETIME()
           FROM applications a
           JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0
          WHERE a.flag_deleted = 0 AND uc.status = 'In Portfolio' AND a.application_status_id <> @p0`, [completed]);
    }
    // accepted in Underwriting but the application never moved off Awaiting Initial Review / Submitted
    const underwriting = await sid('UNDERWRITING');
    if (underwriting) {
      await db.query(
        `UPDATE a SET application_status_id = @p0, submitted_at = COALESCE(a.submitted_at, uc.accepted_at), updated_at = SYSUTCDATETIME()
           FROM applications a
           JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0
           JOIN application_statuses st ON st.application_status_id = a.application_status_id
          WHERE a.flag_deleted = 0 AND uc.accepted_at IS NOT NULL
            AND uc.status NOT IN ('In Portfolio','Closed','Rejected','Returned to BDM')
            AND st.code IN ('DRAFT','SUBMITTED')`, [underwriting]);
    }
    if (approved) {
      await db.query(
        `UPDATE a SET application_status_id = @p0, updated_at = SYSUTCDATETIME()
           FROM applications a
           JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0
           JOIN underwriting_steps s  ON s.underwriting_case_id = uc.underwriting_case_id AND s.step_no = 10 AND s.status = 'Completed'
           JOIN application_statuses st ON st.application_status_id = a.application_status_id
          WHERE a.flag_deleted = 0 AND uc.status NOT IN ('In Portfolio','Closed','Rejected')
            AND st.code IN ('CREDIT_REVIEW','UNDERWRITING','SUBMITTED')`, [approved]);
    }
    if (declined) {
      await db.query(
        `UPDATE a SET application_status_id = @p0, updated_at = SYSUTCDATETIME()
           FROM applications a
           JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0
           JOIN application_statuses st ON st.application_status_id = a.application_status_id
          WHERE a.flag_deleted = 0 AND uc.status IN ('Closed','Rejected')
            AND st.code NOT IN ('DECLINED','COMPLETED')`, [declined]);
    }

    // ---- 2nd-charge amounts onto application security rows (from the source enquiry) ----
    await db.query(
      `UPDATE s SET charge_amount = e.charge_amount
         FROM application_security s
         JOIN applications a ON a.application_id = s.application_id
         JOIN enquiries e    ON e.enquiry_id = a.enquiry_id
        WHERE s.flag_deleted = 0 AND s.charge_amount IS NULL AND ISNULL(s.added_value, '') <> 'OTHER_SECURITY'
          AND s.charge_type LIKE '2nd%' AND e.charge_amount IS NOT NULL`);
    const addrKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const others = await db.query(
      `SELECT s.security_id, s.property_address, s.outstanding_loan, e.additional_securities
         FROM application_security s
         JOIN applications a ON a.application_id = s.application_id
         JOIN enquiries e    ON e.enquiry_id = a.enquiry_id
        WHERE s.flag_deleted = 0 AND s.added_value = 'OTHER_SECURITY' AND s.charge_amount IS NULL
          AND e.additional_securities IS NOT NULL`);
    for (const r of others) {
      let secs = [];
      try { secs = JSON.parse(r.additional_securities) || []; } catch (_) { secs = []; }
      const m = (Array.isArray(secs) ? secs : []).find((x) => x && addrKey(x.address || x.description) === addrKey(r.property_address));
      if (!m || !/^2nd/i.test(String(m.charge_type || ''))) continue;
      const amt = Number(m.charge_amount) > 0 ? Number(m.charge_amount) : (Number(m.existing_charge) > 0 ? Number(m.existing_charge) : null);
      if (amt == null) continue;
      await db.query(`UPDATE application_security SET charge_amount = @p1, charge_type = '2nd' WHERE security_id = @p0`, [r.security_id, amt]);
    }

    // ---- LTV re-compute: enquiries ----
    const enqs = await db.query(
      `SELECT enquiry_id, amount_requested, estimated_value, charge_type, charge_amount, additional_securities
         FROM enquiries WHERE flag_deleted = 0`);
    for (const e of enqs) {
      let secs = [];
      try { secs = e.additional_securities ? JSON.parse(e.additional_securities) : []; } catch (_) { secs = []; }
      const p = ltvPair(e.amount_requested, [e, ...(Array.isArray(secs) ? secs : [])]);
      if (p.our == null) continue;
      await db.query('UPDATE enquiries SET ltv_pct = @p1, total_ltv_pct = @p2 WHERE enquiry_id = @p0', [e.enquiry_id, p.our, p.total]);
    }
    // ---- LTV re-compute: applications (from their own security rows) ----
    const apps = await db.query('SELECT application_id, amount_requested FROM applications WHERE flag_deleted = 0');
    for (const a of apps) {
      const secs = await db.query(
        `SELECT estimated_value, charge_type, charge_amount, outstanding_loan
           FROM application_security WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id`, [a.application_id]);
      const p = ltvPair(a.amount_requested, secs);
      if (p.our == null) continue;
      await db.query('UPDATE applications SET ltv_pct = @p1, total_ltv_pct = @p2 WHERE application_id = @p0', [a.application_id, p.our, p.total]);
    }
  },
  async down(db) {
    await db.raw(`UPDATE application_statuses SET name = 'Draft' WHERE code = 'DRAFT';`);
    for (const [t, c] of [['application_security', 'charge_amount'], ['applications', 'total_ltv_pct'], ['enquiries', 'total_ltv_pct']]) {
      await db.raw(`IF COL_LENGTH('dbo.${t}','${c}') IS NOT NULL ALTER TABLE dbo.${t} DROP COLUMN ${c};`);
    }
  },
};
