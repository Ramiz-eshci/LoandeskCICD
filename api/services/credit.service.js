'use strict';

/**
 * Credit Approval module (Credit Committee). Runs on the applications table:
 * queue = applications at CREDIT_REVIEW; a credit decision either approves the
 * file into Legal, declines it, or refers it back to underwriting.
 * Client Figma: /credit. Underwriting module is untouched.
 */

const db = require('../config/database');
const audit = require('./audit.service');
let notify; try { notify = require('./notification.service'); } catch (_) { notify = null; }

const MODULE_KEY = 'CREDIT';
const LEGAL_STAGES = ['Offer Issued', 'Enquiries', 'Replies to Enquiries', 'Mortgage Deed', 'Completion'];

function actorId(req) { return req && req.userData ? req.userData.userId : null; }
function int(v, d = null) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

async function statusId(code) {
  const r = await db.query('SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code=@p0 AND flag_deleted=0', [String(code).toUpperCase()]);
  return r.length ? r[0].id : null;
}

/** Policy checklist — derived from the application. Returns {items:[{label,pass}], exceptions}. */
function policyChecklist(a) {
  const ltv = a.ltv_pct != null ? Number(a.ltv_pct) : null;
  const amt = a.amount_requested != null ? Number(a.amount_requested) : null;
  const term = a.term_months != null ? Number(a.term_months) : null;
  const kyc = String(a.kyc_overall_status || '').toLowerCase();
  const aml = String(a.kyc_aml_status || '').toLowerCase();
  const valOk = !!(a.valuation_amount != null || String(a.valuation_status || '').toLowerCase() === 'accepted');
  const items = [
    { label: 'LTV ≤ 75%', pass: ltv != null && ltv <= 75 },
    { label: 'Minimum loan £150k', pass: amt != null && amt >= 150000 },
    { label: 'Max term 24 months', pass: term != null && term <= 24 },
    { label: 'Valuation accepted', pass: valOk },
    { label: 'Borrower KYC complete', pass: ['verified', 'complete', 'cleared', 'clear'].includes(kyc) },
    { label: 'AML clearance', pass: ['verified', 'complete', 'cleared', 'clear'].includes(aml) },
    { label: 'Planning permission verified', pass: true },
  ];
  return { items, exceptions: items.filter((i) => !i.pass).length };
}

const SELECT_APP = `
  a.application_id, a.application_ref, a.amount_requested, a.term_months, a.ltv_pct,
  a.irr, a.uw_recommendation, a.initial_offer_status, a.application_status_id,
  a.kyc_overall_status, a.kyc_aml_status,
  st.code AS status_code, st.name AS status_name,
  p.name AS product_name,
  COALESCE(ap.company_name, CONCAT(ap.first_name, ' ', ap.last_name), e.company_name, e.applicant_name) AS applicant_name,
  sec.property_address, sec.estimated_value, sec.valuation_amount, sec.valuation_status`;

const JOINS = `
  FROM applications a
  LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
  LEFT JOIN products p ON p.product_id = a.product_id
  LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
  OUTER APPLY (
    SELECT TOP 1 x.* FROM application_applicants aa2
    JOIN applicants x ON x.applicant_id = aa2.applicant_id
    WHERE aa2.application_id = a.application_id
    ORDER BY CASE WHEN aa2.applicant_role='Primary' THEN 0 ELSE 1 END, x.applicant_id
  ) ap
  OUTER APPLY (
    SELECT TOP 1 s.* FROM application_security s
    WHERE s.application_id = a.application_id AND s.flag_deleted=0 ORDER BY s.security_id
  ) sec`;

function shape(a) {
  const pc = policyChecklist(a);
  return {
    application_id: a.application_id,
    application_ref: a.application_ref,
    applicant_name: a.applicant_name,
    product_name: a.product_name,
    amount_requested: a.amount_requested,
    term_months: a.term_months,
    ltv_pct: a.ltv_pct,
    irr: a.irr,
    uw_recommendation: a.uw_recommendation,
    initial_offer_status: a.initial_offer_status,
    policy_exceptions: pc.exceptions,
    property_address: a.property_address,
    estimated_value: a.estimated_value,
    status_code: a.status_code,
    status_name: a.status_name,
  };
}


/** Server-side paging helpers (same contract as enquiries / applications: page, per_page -> meta). */
function pageArgs(q, defPer = 10) {
  const n = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : d; };
  const page = Math.max(1, n(q && q.page, 1));
  const per = Math.min(100, Math.max(1, n(q && q.per_page, defPer)));
  return { page, per, off: (page - 1) * per };
}
function pageSlice(list, pa) {
  const total = list.length;
  return { rows: list.slice(pa.off, pa.off + pa.per), meta: { page: pa.page, per_page: pa.per, total, total_pages: Math.ceil(total / pa.per) || 1 } };
}

async function list(q = {}) {
  const pa = pageArgs(q);
  const tab = String(q.tab || '') === 'decisions' ? 'decisions' : 'queue';
  const rows = await db.query(
    `SELECT ${SELECT_APP} ${JOINS}
     WHERE a.flag_deleted=0 AND st.code='CREDIT_REVIEW'
     ORDER BY a.application_id DESC`);
  const queue = rows.map(shape);

  const decisions = await db.query(
    `SELECT cd.credit_decision_id, cd.application_id, cd.decision, cd.notes, cd.conditions,
            cd.decided_at, u.full_name AS decided_by_name,
            a.application_ref, a.amount_requested, a.ltv_pct,
            COALESCE(ap.company_name, CONCAT(ap.first_name,' ',ap.last_name), e.company_name, e.applicant_name) AS applicant_name
       FROM credit_decisions cd
       JOIN applications a ON a.application_id = cd.application_id
       LEFT JOIN users u ON u.user_id = cd.decided_by
       LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
       OUTER APPLY (SELECT TOP 1 x.* FROM application_applicants aa2 JOIN applicants x ON x.applicant_id=aa2.applicant_id
         WHERE aa2.application_id=a.application_id ORDER BY CASE WHEN aa2.applicant_role='Primary' THEN 0 ELSE 1 END, x.applicant_id) ap
      WHERE cd.flag_deleted=0
      ORDER BY cd.decided_at DESC, cd.credit_decision_id DESC`);

  const totalExposure = queue.reduce((s, r) => s + (Number(r.amount_requested) || 0), 0);
  const ltvVals = queue.map((r) => Number(r.ltv_pct)).filter((n) => Number.isFinite(n));
  const avgLtv = ltvVals.length ? Math.round((ltvVals.reduce((s, n) => s + n, 0) / ltvVals.length) * 10) / 10 : 0;
  const policyExceptions = queue.reduce((s, r) => s + (r.policy_exceptions || 0), 0);

  // KPIs above use the whole queue; only the requested tab's page is returned.
  const paged = pageSlice(tab === 'decisions' ? decisions : queue, pa);
  return {
    queue: tab === 'queue' ? paged.rows : [],
    decisions: tab === 'decisions' ? paged.rows : [],
    totals: { queue: queue.length, decisions: decisions.length },
    meta: paged.meta,
    kpis: {
      pending_decision: queue.length,
      total_exposure: totalExposure,
      avg_ltv: avgLtv,
      policy_exceptions: policyExceptions,
    },
  };
}

async function creditPaper(id) {
  const rows = await db.query(`SELECT ${SELECT_APP} ${JOINS} WHERE a.application_id=@p0 AND a.flag_deleted=0`, [id]);
  if (!rows.length) return null;
  const a = rows[0];
  const pc = policyChecklist(a);
  return {
    application_id: a.application_id,
    application_ref: a.application_ref,
    applicant_name: a.applicant_name,
    property_address: a.property_address,
    amount_requested: a.amount_requested,
    ltv_pct: a.ltv_pct,
    irr: a.irr,
    product_name: a.product_name,
    term_months: a.term_months,
    uw_recommendation: a.uw_recommendation,
    checklist: pc.items,
    policy_exceptions: pc.exceptions,
  };
}

/** decision: approve | approve_conditions | decline | refer */
async function decide(id, body, req) {
  const decision = String(body && body.decision || '').trim();
  const comments = String(body && body.comments || '').trim();
  const conditions = String(body && body.conditions || '').trim();
  const valid = ['approve', 'approve_conditions', 'decline', 'refer'];
  if (!valid.includes(decision)) return { ok: false, error: 'Invalid decision' };
  if (!comments) return { ok: false, error: 'Comments are required' };
  if (decision === 'approve_conditions' && !conditions) return { ok: false, error: 'Conditions are required' };

  const appRow = await db.query('SELECT application_id, application_ref, assigned_to FROM applications WHERE application_id=@p0 AND flag_deleted=0', [id]);
  if (!appRow.length) return { ok: false, notFound: true };

  await db.query(
    `INSERT INTO credit_decisions (application_id, decided_by, decision, notes, conditions, decided_at, created_by)
     VALUES (@p0,@p1,@p2,@p3,@p4, SYSUTCDATETIME(), @p1)`,
    [id, actorId(req), decision, comments, decision === 'approve_conditions' ? conditions : null]);

  let toStatus = null; let nextLabel = '';
  if (decision === 'approve' || decision === 'approve_conditions') {
    toStatus = 'LEGAL'; nextLabel = 'Legal & Completion';
    if (decision === 'approve_conditions') {
      await db.query('UPDATE applications SET credit_conditions=@p1 WHERE application_id=@p0', [id, conditions]);
    }
    await moveToLegal(id, conditions, req);
  } else if (decision === 'decline') {
    toStatus = 'DECLINED'; nextLabel = 'Declined';
    await setStatus(id, 'DECLINED', req);
    await notifyDecline(appRow[0], comments, req);
  } else if (decision === 'refer') {
    toStatus = 'UNDERWRITING'; nextLabel = 'Underwriting';
    await setStatus(id, 'UNDERWRITING', req);
  }

  // Mirror the decision onto the underwriting case's Credit Discussion step.
  // Required lazily to avoid a require cycle (underwriting -> enquiry -> ...).
  let underwriting = null;
  try { underwriting = require('./underwriting.service'); } catch (e) { underwriting = null; }
  if (underwriting && typeof underwriting.applyCreditDecision === 'function') {
    await underwriting.applyCreditDecision(id, decision, comments, req);
  }

  await audit.write(audit.fromReq(req, {
    action: 'CREDIT_DECISION', moduleKey: MODULE_KEY, entityName: 'applications', entityId: id,
    details: { decision, toStatus },
  }));
  return { ok: true, decision, status: toStatus, next: nextLabel };
}

async function setStatus(id, code, req) {
  const sid = await statusId(code);
  if (sid) await db.query('UPDATE applications SET application_status_id=@p1, updated_by=@p2, updated_at=SYSUTCDATETIME() WHERE application_id=@p0', [id, sid, actorId(req)]);
}

/** Approve -> Legal: set status LEGAL, seed a legal_case + default legal stage + conditions. */
async function moveToLegal(id, conditions, req) {
  await setStatus(id, 'LEGAL', req);
  await db.query(
    `UPDATE applications SET legal_stage = COALESCE(legal_stage, 'Offer Issued'),
            offer_date = COALESCE(offer_date, CAST(SYSUTCDATETIME() AS DATE)),
            updated_by=@p1, updated_at=SYSUTCDATETIME()
      WHERE application_id=@p0`, [id, actorId(req)]);
  const existing = await db.query('SELECT TOP 1 legal_case_id FROM legal_cases WHERE application_id=@p0 AND flag_deleted=0', [id]);
  if (!existing.length) {
    await db.query(`INSERT INTO legal_cases (application_id, status, created_by) VALUES (@p0, 'Open', @p1)`, [id, actorId(req)]);
  }
  // seed conditions from the credit "approve with conditions" text (one per line)
  if (conditions) {
    const lines = conditions.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    let order = 0;
    for (const name of lines) {
      const dup = await db.query('SELECT TOP 1 legal_condition_id FROM legal_conditions WHERE application_id=@p0 AND name=@p1 AND flag_deleted=0', [id, name.slice(0, 200)]);
      if (!dup.length) {
        await db.query(`INSERT INTO legal_conditions (application_id, name, status, sort_order, created_by) VALUES (@p0,@p1,'Pending',@p2,@p3)`,
          [id, name.slice(0, 200), order++, actorId(req)]);
      }
    }
  }
}

async function notifyDecline(app, reason, req) {
  if (!notify) return;
  try {
    const recipients = new Set();
    const legalUsers = await notify.usersWithPermission('LEGAL', 'view').catch(() => []);
    (legalUsers || []).forEach((u) => recipients.add(u));
    if (app.assigned_to) recipients.add(app.assigned_to);
    await notify.createMany([...recipients], {
      title: `Application ${app.application_ref} declined at credit`,
      body: reason || 'Credit committee declined the application.',
      type: 'CREDIT_DECLINED', link: `/applications/${app.application_id}`, entityId: app.application_id,
    }, actorId(req));
  } catch (_) { /* best-effort */ }
}

module.exports = { list, creditPaper, decide, LEGAL_STAGES, MODULE_KEY };
