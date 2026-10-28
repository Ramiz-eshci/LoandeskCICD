'use strict';

/**
 * Underwriting workflow engine (Module-6). ALL workflow state is persisted and
 * ALL sequence / permission / mandatory-field rules are enforced HERE (server),
 * never trusted from the frontend. Reuses the existing underwriting_cases table
 * as the case root; per-step rows live in underwriting_steps.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { latestGrossApply, appBasisSql, appAmountBasisSql, appNetSql } = require('../utils/loanAmount');
const { refreshApplicationLtv, totalLtv } = require('../utils/ltv');
const audit = require('./audit.service');
const CFG = require('../config/underwriting.config');
const mail = require('./mail.service');
const emailHub = require('./emailHub.service');
const dealSummary = require('./dealSummary.service');
const { config: envConfig } = require('../config/env');
const pdf = require('./pdf/enquiry-pdf.service');
const enquirySvc = require('./enquiry.service');
const liveLoan = require('./liveLoan.service');
const workflow = require('./workflow.service');
const { roleHasPermission } = require('../middlewares/rbac');

const S = CFG.CASE_STATUS;
const ST = CFG.STEP_STATUS;

// Workflow role name -> fixed role_id (rename-safe: ids are stable).
const ROLE_ID = { Underwriter: 3, Credit: 4, 'Credit Manager': 4, Solicitor: 6, 'Valuation User': 13, Broker: 14 };
function allowedRoleIds(step) { return (step.roles || []).map((r) => ROLE_ID[r]).filter(Boolean); }

const int = (v, d = null) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
function actorId(req) { return req && req.userData ? req.userData.userId : null; }
function isSuper(req) { return !!(req && req.userData && (req.userData.isSuperAdmin || req.userData.isCompanyAdmin)); }

/**
 * Can this user act on this step? Super/company admin bypasses; else the active
 * role must hold the step's checklist permission (step.perm, Roles matrix).
 * Steps without a perm fall back to the fixed role list.
 */
async function canActStep(step, req) {
  if (isSuper(req)) return true;
  const rid = req && req.userData ? req.userData.roleId : null;
  if (!rid || !step) return false;
  if (Array.isArray(step.perm) && step.perm.length === 2) {
    return roleHasPermission(rid, step.perm[0], step.perm[1]);
  }
  return allowedRoleIds(step).includes(rid);
}

/**
 * Final Credit Committee decision rights (client 20-10-2026): Agree to Fund = APPROVE,
 * Cannot Proceed - Close = REJECT on Roles > Underwriting Stages > 5. Final Credit Committee.
 */
const COMMITTEE_PERM = 'UNDERWRITING_STAGES.CREDIT_COMMITTEE';
async function canCommittee(req, action) {
  if (isSuper(req)) return true;
  const rid = req && req.userData ? req.userData.roleId : null;
  return !!rid && roleHasPermission(rid, COMMITTEE_PERM, action);
}

/** Can this user VIEW this stage? (stage module 'view', or anyone who can work it). */
async function canViewStep(step, req) {
  if (isSuper(req)) return true;
  const rid = req && req.userData ? req.userData.roleId : null;
  if (!rid || !step) return false;
  if (!Array.isArray(step.perm) || step.perm.length !== 2) return true;
  if (step.perm[0] === 'UNDERWRITING.CASE') return true; // step 1 = case acceptance, visible with the case
  return (await roleHasPermission(rid, step.perm[0], 'view')) || canActStep(step, req);
}

/**
 * Attach can_view / can_act (per stage) for the caller. Stages the role may not
 * view have their data withheld, so the UI can only show a locked placeholder.
 */
async function withStepAccess(c, req) {
  if (!c || !Array.isArray(c.steps)) return c;
  for (const st of c.steps) {
    const def = CFG.stepByNo(st.step_no);
    st.can_view = def ? await canViewStep(def, req) : false;
    st.can_act = st.can_view && def ? await canActStep(def, req) : false;
    if (!st.can_view) { st.data = null; st.notes = null; st.decision = null; }
  }
  return c;
}

async function roleNameOf(roleId) {
  const r = await db.query('SELECT role_name FROM roles WHERE role_id = @p0', [roleId]);
  return r[0] ? r[0].role_name : null;
}

async function writeAudit(caseId, { stepNo = null, action, from = null, to = null, req, reason = null }) {
  const roleName = req && req.userData ? await roleNameOf(req.userData.roleId) : null;
  await db.query(
    `INSERT INTO underwriting_audit (underwriting_case_id, step_no, action, from_status, to_status, user_id, role_name, reason)
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)`,
    [caseId, stepNo, action, from, to, actorId(req), roleName, reason ? String(reason).slice(0, 2000) : null],
  );
}

/* ------------------------------------------------------------------ */
/*  CASE lifecycle                                                    */
/* ------------------------------------------------------------------ */

/** Create the underwriting case for an application if one does not exist. */
async function ensureCase(applicationId, req) {
  const existing = await db.query(
    'SELECT underwriting_case_id, status FROM underwriting_cases WHERE application_id = @p0 AND flag_deleted = 0', [applicationId]);
  if (existing.length) {
    const ex = existing[0];
    if (ex.status === S.CLOSED) {
      await db.query('UPDATE underwriting_cases SET status = @p1, current_step = 1, closed_reason = NULL, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0', [ex.underwriting_case_id, S.NEW_REVIEW, actorId(req)]);
      await writeAudit(ex.underwriting_case_id, { action: 'CASE_REOPENED', to: S.NEW_REVIEW, req });
    }
    return ex.underwriting_case_id;
  }
  const out = await db.query(
    `INSERT INTO underwriting_cases (application_id, status, current_step, created_by)
     OUTPUT INSERTED.underwriting_case_id AS id VALUES (@p0, @p1, 1, @p2)`,
    [applicationId, S.NEW_REVIEW, actorId(req)]);
  const id = out[0].id;
  await writeAudit(id, { action: 'CASE_CREATED', to: S.NEW_REVIEW, req });
  return id;
}

/** Seed the 8 step rows for a case (step 1 Available, rest Locked). */
async function seedSteps(caseId, req) {
  const have = await db.query('SELECT 1 FROM underwriting_steps WHERE underwriting_case_id = @p0', [caseId]);
  if (have.length) return;
  for (const s of CFG.STEPS) {
    await db.query(
      `INSERT INTO underwriting_steps (underwriting_case_id, step_no, step_key, status, assigned_role, created_by)
       VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`,
      [caseId, s.no, s.key, s.no === 1 ? ST.AVAILABLE : ST.LOCKED, (s.roles || [])[0] || null, actorId(req)]);
  }
}

/** Backfill any config steps missing for a case (e.g. steps added after the case
 *  was created). Inserts missing rows as Locked so the flow can reach them. Idempotent. */
async function ensureSteps(caseId, req) {
  const rows = await db.query('SELECT step_no FROM underwriting_steps WHERE underwriting_case_id = @p0', [caseId]);
  if (!rows.length) return; // uninitialised case; seedSteps handles first-time creation
  const have = new Set(rows.map((r) => Number(r.step_no)));
  for (const st of CFG.STEPS) {
    if (have.has(Number(st.no))) continue;
    await db.query(
      `INSERT INTO underwriting_steps (underwriting_case_id, step_no, step_key, status, assigned_role, created_by)
       VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`,
      [caseId, st.no, st.key, ST.LOCKED, (st.roles || [])[0] || null, actorId(req)]);
  }
}

async function list(q, opts = {}) {
  const page = Math.max(1, int(q.page, 1));
  const per = Math.min(5000, /* pagination removed (client 21-10-2026) - was 100 */ Math.max(1, int(q.per_page, 10)));
  const p = {};
  let where = 'uc.flag_deleted = 0';
  // Status filter. Sentinels mirror the Enquiry / Application lists (client 07-10-2026):
  //   LIVE            -> hide finished cases (Rejected = declined, Closed), the default view.
  //   CLOSED_DECLINED -> only the finished cases (the "Declined / Closed" chip).
  // Any other value is matched exactly against uc.status.
  const rawUwStatus = String(q.status || '').trim();
  if (rawUwStatus.toUpperCase() === 'LIVE') { where += " AND uc.status NOT IN ('Rejected','Closed','In Portfolio','On Hold','Returned to BDM')"; }
  else if (rawUwStatus.toUpperCase() === 'CLOSED_DECLINED') { where += " AND uc.status IN ('Rejected','Closed')"; }
  else if (rawUwStatus) { where += ' AND uc.status = @status'; p.status = rawUwStatus; }
  // Tab: "awaiting" = new cases waiting for underwriter review.
  if (String(q.tab || '') === 'awaiting') { where += " AND uc.status = 'New Review'"; }
  if (String(q.tab || '') === 'portfolio') { where += " AND uc.status = 'In Portfolio'"; }
  if (String(q.tab || '') === 'returned') { where += " AND uc.status = 'Returned to BDM'"; }
  if (String(q.tab || '') === 'onhold') { where += " AND uc.status = 'On Hold'"; }
  // Stage bar: 99 = with Credit; any other step = at that step and not yet sent to Credit.
  const step = int(q.step);
  if (step === 99) { where += " AND uc.status = 'Sent to Credit'"; }
  else if (step) { where += " AND uc.current_step = @step AND uc.status IN ('In Progress','Pending Information','Ready to Proceed')"; p.step = step; }
  if (int(q.assigned_to)) { where += ' AND uc.underwriter_id = @assigned_to'; p.assigned_to = int(q.assigned_to); }
  // "My deals" toggle (client 07-10-2026): only cases this underwriter owns.
  if (int(q.mine) && int(opts.currentUserId)) { where += ' AND uc.underwriter_id = @me'; p.me = int(opts.currentUserId); }
  // View scope: without UNDERWRITING.ALL_CASES.view a user sees the cases they
  // are the underwriter on, PLUS every case nobody has accepted yet - so the
  // queue is still shared, but a case disappears from everyone else's list the
  // moment one user accepts it.
  if (int(opts.scopeUserId)) {
    where += ' AND (uc.underwriter_id = @scope_uid OR uc.underwriter_id IS NULL)';
    p.scope_uid = int(opts.scopeUserId);
  }
  const search = String(q.search || '').trim();
  if (search) {
    where += ` AND (a.application_ref LIKE @search OR ap.first_name LIKE @search OR ap.last_name LIKE @search
      OR ap.company_name LIKE @search OR p.name LIKE @search)`;
    p.search = '%' + search + '%';
  }
  const FROM = `FROM underwriting_cases uc
       LEFT JOIN applications a ON a.application_id = uc.application_id
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
       LEFT JOIN products p ON p.product_id = a.product_id
       LEFT JOIN branches b ON b.branch_id = a.branch_id
       LEFT JOIN users u ON u.user_id = uc.underwriter_id
       LEFT JOIN users bdm ON bdm.user_id = a.assigned_to
       LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
       ${latestGrossApply('enq')}`;
  p.off = (page - 1) * per; p.lim = per;
  const LIST_SQL =
    `SELECT uc.underwriting_case_id, uc.application_id, uc.status, uc.current_step, uc.decision,
            uc.underwriter_id, uc.sla_due_date, uc.accepted_at, uc.created_at, uc.updated_at,
            a.application_ref, a.amount_requested, a.ltv_pct, a.total_ltv_pct, a.initial_offer_note,
            ${appBasisSql('enq')} AS loan_basis,
            ${appAmountBasisSql('enq')} AS amount_basis,
            ${appNetSql('enq', 'a')} AS net_loan,
            ap.first_name, ap.last_name, ap.company_name,
            p.name AS product_name, b.branch_name, u.full_name AS underwriter_name, bdm.full_name AS bdm_name,
            (SELECT TOP 1 status FROM underwriting_steps ss WHERE ss.underwriting_case_id = uc.underwriting_case_id AND ss.step_no = 2) AS val_status,
            (SELECT TOP 1 status FROM underwriting_steps ss WHERE ss.underwriting_case_id = uc.underwriting_case_id AND ss.step_no = 3) AS kyc_status
       ${FROM}
      WHERE ${where}
      ORDER BY uc.underwriting_case_id DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`;
  // DEBUG (23-10-2026): raw underwriting list query - remove after the timeout is found.
  // console.log('[uw list] params:', JSON.stringify(p)); // eslint-disable-line no-console
  // console.log('[uw list] SQL:\n' + LIST_SQL); // eslint-disable-line no-console
  const t0 = Date.now();
  const rows = await db.queryNamed(LIST_SQL, p);
  console.log(`[uw list] rows=${rows.length} in ${Date.now() - t0} ms`); // eslint-disable-line no-console
  // Count only needs the joins the WHERE uses (no offer / indicative JSON apply) - 23-10-2026.
  const COUNT_FROM = `FROM underwriting_cases uc
       LEFT JOIN applications a ON a.application_id = uc.application_id
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
       LEFT JOIN products p ON p.product_id = a.product_id`;
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total ${COUNT_FROM} WHERE ${where}`, p);
  const total = cnt[0] ? cnt[0].total : 0;
  return { rows, meta: { page, per_page: per, total, total_pages: Math.ceil(total / per) || 1 } };
}

async function getCase(id) {
  const rows = await db.query(
    `SELECT uc.*, a.application_ref, a.amount_requested, a.ltv_pct, a.total_ltv_pct, a.term_months, a.irr_pct,
            a.signed_offer_doc_id,
            (SELECT TOP 1 sod.file_name FROM application_documents sod
              WHERE sod.app_document_id = a.signed_offer_doc_id AND sod.flag_deleted = 0) AS signed_offer_file_name,
            a.branch_id, a.enquiry_id, COALESCE(a.broker_id, e.broker_id) AS broker_id,
            COALESCE(NULLIF(br.company,''), br.name, NULLIF(ebr.company,''), ebr.name) AS broker_name,
            COALESCE(br.email, ebr.email) AS broker_email, COALESCE(NULLIF(br.company,''), ebr.company) AS broker_company,
            COALESCE(br.name, ebr.name) AS broker_contact_name, COALESCE(br.phone, ebr.phone) AS broker_phone,
            b.branch_name, p.name AS product_name,
            u.full_name AS underwriter_name, bdm.full_name AS bdm_name,
            u.email AS underwriter_email, bdm.email AS bdm_email, a.agreed_terms,
            ap.first_name, ap.last_name, ap.company_name, ap.email AS applicant_email, ap.phone AS applicant_phone,
            atp.name AS applicant_type, a.net_advance, s.property_address, s.estimated_value, s.gdv,
            ln.loan_id AS portfolio_loan_id, ln.loan_number AS portfolio_loan_number,
            ${appBasisSql('e')} AS loan_basis,
            ${appAmountBasisSql('e')} AS amount_basis,
            ${appNetSql('e', 'a')} AS net_loan
       FROM underwriting_cases uc
       LEFT JOIN applications a ON a.application_id = uc.application_id
       LEFT JOIN branches b ON b.branch_id = a.branch_id
       LEFT JOIN brokers br ON br.broker_id = a.broker_id
       LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
       LEFT JOIN brokers ebr ON ebr.broker_id = e.broker_id
       LEFT JOIN products p ON p.product_id = a.product_id
       LEFT JOIN users u ON u.user_id = uc.underwriter_id
       LEFT JOIN users bdm ON bdm.user_id = a.assigned_to
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
       LEFT JOIN applicant_types atp ON atp.applicant_type_id = ap.applicant_type_id
       OUTER APPLY (SELECT TOP 1 property_address, estimated_value, gdv FROM application_security asec WHERE asec.application_id = a.application_id AND asec.flag_deleted = 0 ORDER BY asec.security_id) s
       OUTER APPLY (SELECT TOP 1 loan_id, loan_number FROM loans l WHERE l.application_id = a.application_id AND l.flag_deleted = 0 ORDER BY l.loan_id DESC) ln
       ${latestGrossApply('e')}
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0`, [id]);
  if (!rows.length) return null;
  await ensureSteps(id, null);
  const c = rows[0];
  // Client 05-10-2026: Property Value (Estimated Value) and GDV come from the ACCEPTED
  // indicative version (the one behind the accepted offer) — the figures the client
  // actually agreed — not from the enquiry security fields and not merely "when empty".
  // Order: accepted offer's indicative, then the sent offer's indicative, then the
  // latest sent indicative as a last resort.
  if (c.enquiry_id) {
    try {
      let indRow = null;
      const off = await db.query(
        `SELECT TOP 1 offer_json FROM enquiry_offers
           WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status IN ('Accepted', 'Sent')
           ORDER BY ${c.revised_offer_pending ? 'version_no DESC' : "CASE WHEN status = 'Accepted' THEN 0 ELSE 1 END, version_no DESC"}`, [c.enquiry_id]);
      const indId = off.length ? Number((safeJson(off[0].offer_json) || {}).indicative_id) : 0;
      if (Number.isFinite(indId) && indId) {
        const r = await db.query(
          `SELECT TOP 1 calc_json, inputs_json FROM enquiry_indicatives
             WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [indId, c.enquiry_id]);
        if (r.length) indRow = r[0];
      }
      if (!indRow) {
        const r = await db.query(
          `SELECT TOP 1 calc_json, inputs_json FROM enquiry_indicatives
             WHERE enquiry_id = @p0 AND flag_deleted = 0
             ORDER BY CASE WHEN status = 'Sent' THEN 0 ELSE 1 END, version_no DESC`, [c.enquiry_id]);
        if (r.length) indRow = r[0];
      }
      if (indRow) {
        const inp = safeJson(indRow.inputs_json) || {};
        const calc = safeJson(indRow.calc_json) || {};
        const pickNum = (...xs) => { for (const x of xs) { const n = Number(x); if (Number.isFinite(n) && n > 0) return n; } return null; };
        const pv = pickNum(inp.property_value, inp.security_value, calc.total_security_value, calc.main_property_value, calc.property_value);
        const g = pickNum(inp.gdv, calc.gdv);
        if (pv != null) c.estimated_value = pv;
        if (g != null) c.gdv = g;
      }
    } catch (e) { /* best-effort: never block the case load */ }
  }
  try { c.signed_offer_docs = await listSignedOffers(c.application_id, c.signed_offer_doc_id); } catch (_) { c.signed_offer_docs = []; }
  // Client 07-10-2026: every security on the application (main + other securities)
  // so the Valuation Instruction can target a specific one and the side panel can
  // list all of them, not just the first.
  try {
    c.securities = await db.query(
      `SELECT security_id, property_address, postcode, charge_type, estimated_value, gdv, charge_amount, outstanding_loan
         FROM application_security
        WHERE application_id = @p0 AND flag_deleted = 0
        ORDER BY security_id`, [c.application_id]);
  } catch (_) { c.securities = []; }
  // Client 19-10-2026: Total LTV for the Case Summary (and header) = the application's own
  // total_ltv_pct (the LTV % entered on the indicative / offer); else the enquiry's; else
  // the application's figures.
  c.summary_total_ltv_pct = totalLtv(c.amount_requested, c.securities);
  if (c.total_ltv_pct != null) {
    c.summary_total_ltv_pct = Number(c.total_ltv_pct);
  } else if (c.enquiry_id) {
    const [eq] = await db.query('SELECT total_ltv_pct FROM enquiries WHERE enquiry_id = @p0', [c.enquiry_id]).catch(() => []);
    if (eq && eq.total_ltv_pct != null) c.summary_total_ltv_pct = Number(eq.total_ltv_pct);
  }
  // Client 16-10-2026 (Funds to Solicitor step): the broker is paid as soon as the deal
  // completes - broker fee + the broker's share of the arrangement fee - and the
  // Funds Drawn Down card only applies when the agreed terms carry drawdowns.
  {
    const at = safeJson(c.agreed_terms) || {};
    const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : 0; };
    c.broker_fee = n(at.broker_fee);
    c.broker_arrangement_share = n(at.broker_fee_amount);
    c.broker_payee_name = at.broker_payee_name || c.broker_company || c.broker_name || null;
    c.drawdowns = Array.isArray(at.drawdowns) ? at.drawdowns.filter((d) => d && (Number(d.amount) > 0 || Number(d.gross) > 0 || Number(d.net) > 0)) : [];
    delete c.agreed_terms;
  }
  c.steps = await db.query(
    `SELECT underwriting_step_id, step_no, step_key, status, assigned_to, assigned_role,
            data, decision, notes, started_at, completed_at
       FROM underwriting_steps WHERE underwriting_case_id = @p0 ORDER BY step_no`, [id]);
  // Client 15-10-2026: Solicitor Quote (step 4) starts from what the BDM captured on the
  // enquiry (step 3): Single / Dual representation + the borrower's solicitor. Only fills
  // what the step has not saved yet - anything typed in underwriting is never overwritten.
  if (c.enquiry_id) {
    try {
      const er = await db.query(
        `SELECT rep_type, borrower_sol_firm, borrower_sol_contact, borrower_sol_address,
                borrower_sol_telephone, borrower_sol_email, borrower_solicitor_id
           FROM enquiries WHERE enquiry_id = @p0`, [c.enquiry_id]);
      const en = er[0];
      const st4 = (c.steps || []).find((x) => Number(x.step_no) === 4);
      if (en && st4 && (en.rep_type || en.borrower_sol_firm || en.borrower_sol_contact)) {
        const d = safeJson(st4.data) || {};
        const f = (d.fields && typeof d.fields === 'object') ? d.fields : {};
        let changed = false;
        if (!f.rep_type && en.rep_type) { f.rep_type = en.rep_type; changed = true; }
        if (String(f.rep_type || en.rep_type || '').toLowerCase() !== 'dual') {
          const bs = (f.borrower_solicitor && typeof f.borrower_solicitor === 'object') ? { ...f.borrower_solicitor } : {};
          const map = { firm_name: en.borrower_sol_firm, contact_name: en.borrower_sol_contact, address: en.borrower_sol_address, telephone: en.borrower_sol_telephone, email: en.borrower_sol_email };
          for (const [k, v] of Object.entries(map)) {
            if ((bs[k] == null || bs[k] === '') && v) { bs[k] = v; changed = true; }
          }
          // Client 16-10-2026: the master row picked on the enquiry, so the step's
          // dropdown (and the solicitor's saved checks) line up with it.
          if (!bs.id && en.borrower_solicitor_id && (!bs.firm_name || String(bs.firm_name) === String(en.borrower_sol_firm || ''))) {
            bs.id = Number(en.borrower_solicitor_id); changed = true;
          }
          f.borrower_solicitor = bs;
        }
        if (changed) { d.fields = f; st4.data = JSON.stringify(d); }
      }
    } catch (_) { /* best-effort prefill only */ }
  }
  c.queries = await db.query(
    `SELECT underwriting_query_id, step_no, raised_by, target_role, target_user, description,
            status, response, responded_by, responded_at, created_at
       FROM underwriting_queries WHERE underwriting_case_id = @p0 ORDER BY underwriting_query_id DESC`, [id]);
  // THE WHOLE CASE HISTORY, oldest origin to newest action: the enquiry it came
  // from, the application it became, and this underwriting case. Read on its own
  // the underwriting trail looks like the story starts here - it does not.
  const uwRows = await db.query(
    `SELECT ua.underwriting_audit_id AS audit_id, ua.step_no, ua.action, ua.from_status, ua.to_status,
            ua.user_id, ua.role_name, ua.reason, ua.created_at,
            u.full_name AS user_name
       FROM underwriting_audit ua
       LEFT JOIN users u ON u.user_id = ua.user_id
      WHERE ua.underwriting_case_id = @p0
      ORDER BY ua.underwriting_audit_id DESC`, [id]);
  const uw = uwRows.map((r) => ({
    ...r, underwriting_audit_id: r.audit_id, details: null,
    entity_name: 'underwriting_cases', module: 'Underwriting',
  }));

  const chain = [];
  if (c.application_id) {
    chain.push({ entity: 'applications', id: c.application_id, module: 'Application' });
    const er = await db.query(
      'SELECT TOP 1 enquiry_id FROM applications WHERE application_id = @p0', [c.application_id],
    ).catch(() => []);
    const enquiryId = er[0] && er[0].enquiry_id;
    if (enquiryId) chain.push({ entity: 'enquiries', id: enquiryId, module: 'Enquiry' });
  }
  const logs = chain.length ? await audit.listForChain(chain).catch(() => []) : [];

  c.audit = audit.mergeTrails(uw, logs);
  return c;
}

/** Underwriter accepts the case -> workflow becomes active, steps seeded. */
/**
 * The review stage (Accept / Reject / Return to BDM) is first-come, first-served:
 * whoever acts first owns the case and the other reviewers' buttons must stop
 * working, even on a page they opened before. Only `accept` checked this, so a
 * second reviewer could still reject or return a case someone had already taken.
 *
 * Returns null when the case is still open for review, or an error object naming
 * what happened to it and who did it.
 */
async function reviewGuard(id, verb) {
  const rows = await db.query(
    `SELECT uc.status, uc.accepted_by, uc.underwriter_id,
            COALESCE(ua.full_name, uu.full_name) AS owner_name
       FROM underwriting_cases uc
       LEFT JOIN users ua ON ua.user_id = uc.accepted_by
       LEFT JOIN users uu ON uu.user_id = uc.underwriter_id
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0`, [id]);
  if (!rows.length) return { notFound: true };
  const r = rows[0];
  if (String(r.status) === S.NEW_REVIEW) return null;
  const who = r.owner_name ? ` by ${r.owner_name}` : '';
  const what = String(r.status) === S.REJECTED ? `already rejected${who}`
    : String(r.status) === S.CLOSED ? `already returned to the BDM / closed${who}`
      : `already accepted${who}`;
  return { ok: false, error: `This case was ${what}, so it can no longer be ${verb}. Refresh to see its current state.` };
}

async function accept(id, req) {
  const blocked = await reviewGuard(id, 'accepted');
  if (blocked) return blocked;
  const rows = await db.query('SELECT status FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [id]);
  if (!rows.length) return { notFound: true };
  const from = rows[0].status;
  await db.query(
    `UPDATE underwriting_cases SET status = @p1, accepted_by = @p2, accepted_at = SYSUTCDATETIME(),
            underwriter_id = COALESCE(underwriter_id, @p2), current_step = 2,
            sla_due_date = CAST(DATEADD(day, @p3, SYSUTCDATETIME()) AS DATE), updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE underwriting_case_id = @p0`, [id, S.IN_PROGRESS, actorId(req), CFG.SLA_DAYS]);
  await seedSteps(id, req);
  // Step 1 (Initial Review) IS the acceptance -> mark it complete; underwriting begins at Step 2 (Valuation Instruction).
  await db.query(`UPDATE underwriting_steps SET status = @p1, completed_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND step_no = 1`, [id, ST.COMPLETED]);
  await db.query(`UPDATE underwriting_steps SET status = @p1, started_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND step_no = 2`, [id, ST.IN_PROGRESS]);
  await writeAudit(id, { action: 'CASE_ACCEPTED', from, to: S.IN_PROGRESS, req });
  // Client 15-10-2026: a case can be accepted straight from the Underwriting list without
  // the application ever being "Accepted / sent to underwriting" on its own screen. The
  // application then still said "Awaiting Initial Review" / "Submitted" - move it to
  // Underwriting (only forward: a later status is never pulled back).
  try {
    const ar = await db.query(
      `SELECT a.application_id, st.code
         FROM underwriting_cases uc
         JOIN applications a ON a.application_id = uc.application_id
         LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
        WHERE uc.underwriting_case_id = @p0`, [id]);
    const a = ar[0];
    if (a && ['DRAFT', 'SUBMITTED', ''].includes(String(a.code || '').toUpperCase())) {
      await setAppStatus(a.application_id, 'UNDERWRITING', req);
      await db.query(
        `UPDATE applications SET submitted_at = COALESCE(submitted_at, SYSUTCDATETIME()),
                underwriter_id = COALESCE(underwriter_id, @p1)
          WHERE application_id = @p0`, [a.application_id, actorId(req)]);
    }
  } catch (e) { console.error('[underwriting] accept: application status not moved: ' + e.message); }
  return { ok: true, id };
}


/** Resolve an application_statuses id by code (for review-stage app moves). */
async function appStatusId(code) {
  const r = await db.query('SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code = @p0 AND flag_deleted = 0', [String(code).toUpperCase()]);
  return r[0] ? r[0].id : null;
}
async function setAppStatus(appId, code, req) {
  const id = await appStatusId(code);
  if (!id) return;
  await db.query('UPDATE applications SET application_status_id = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE application_id = @p0', [appId, id, actorId(req)]);
}

/** Move the application forward only - never pulls a later status (Legal, Completed,
 *  Declined) back. Pipeline order = application_statuses.sort_order. */
async function setAppStatusForward(appId, code, req) {
  const r = await db.query(
    `SELECT cur.sort_order AS cur_order, cur.code AS cur_code, tgt.sort_order AS tgt_order
       FROM applications a
       LEFT JOIN application_statuses cur ON cur.application_status_id = a.application_status_id
       LEFT JOIN application_statuses tgt ON tgt.code = @p1
      WHERE a.application_id = @p0`, [appId, String(code).toUpperCase()]);
  const x = r[0];
  if (!x || ['COMPLETED', 'DECLINED'].includes(String(x.cur_code || '').toUpperCase())) return;
  if (x.cur_order != null && x.tgt_order != null && Number(x.cur_order) >= Number(x.tgt_order)) return;
  await setAppStatus(appId, code, req);
}

/* ------------------------------------------------------------------ */
/*  STEP actions                                                      */
/* ------------------------------------------------------------------ */

async function loadStep(caseId, stepNo) {
  const r = await db.query('SELECT * FROM underwriting_steps WHERE underwriting_case_id = @p0 AND step_no = @p1', [caseId, stepNo]);
  return r[0] || null;
}

/** Save step form/checklist data (does not advance). */
async function saveStep(caseId, stepNo, body, req) {
  const def = CFG.stepByNo(stepNo);
  if (!def) return { ok: false, error: 'Unknown step' };
  if (!(await canActStep(def, req))) return { ok: false, forbidden: true };
  await ensureSteps(caseId, req);
  const step = await loadStep(caseId, stepNo);
  if (!step) return { notFound: true };
  // Free-flow: locked steps are editable/saveable too.
  const notes = body && body.notes ? String(body.notes) : null;
  const badNotes = overLimit('Notes', notes, LIMITS.free_text);
  if (badNotes) return { ok: false, error: badNotes, errors: { notes: badNotes } };
  // Tester 20-10-2026: Valuation "Report Due Date" cannot be in the past. Only NEW or CHANGED
  // dates are checked, so an entry saved earlier with a now-past date can still be re-saved.
  if (Number(stepNo) === 2) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const newF = ((body && body.data) || {}).fields || {};
    const oldF = (safeJson(step.data) || {}).fields || {};
    const dueOf = (f) => [...(Array.isArray(f.entries) ? f.entries : []), f]
      .map((x) => String((x && x.report_due_date) || '').slice(0, 10)).filter(Boolean);
    const had = new Set(dueOf(oldF));
    const bad = dueOf(newF).find((d) => d < today && !had.has(d));
    if (bad) {
      const msg = 'Report Due Date cannot be in the past';
      return { ok: false, error: msg, errors: { report_due_date: msg } };
    }
  }
  const data = JSON.stringify(body && body.data ? body.data : {});
  await db.query(
    `UPDATE underwriting_steps SET data = @p2, notes = @p3,
            status = CASE WHEN status IN (@p4, @p7) THEN @p5 ELSE status END,
            updated_by = @p6, updated_at = SYSUTCDATETIME()
      WHERE underwriting_case_id = @p0 AND step_no = @p1`,
    [caseId, stepNo, data, notes, ST.AVAILABLE, ST.IN_PROGRESS, actorId(req), ST.LOCKED]);
  if (stepNo === KYC_STEP_NO) {
    // Mark Passed / Mark Failed save the step rather than completing it, so the
    // application must be updated here or it stays Pending until (and unless)
    // someone presses Proceed.
    await syncKycToApplication(caseId, (body && body.data) || {}, null, req);
  }
  if (def.key === 'funds_completion') await syncLoanStart(caseId, req);
  // Client 16-10-2026: Solicitor Quote's "Done" follows its checks - unticking one after
  // the step was completed puts it back In Progress; ticking the last one completes it.
  if (Number(stepNo) === 4 && step.status !== ST.SKIPPED) {
    const done = await isStepComplete(4, (body && body.data) || {}, caseId);
    if (done !== (step.status === ST.COMPLETED || step.status === ST.APPROVED)) {
      await db.query(
        `UPDATE underwriting_steps SET status = @p2,
                completed_at = CASE WHEN @p3 = 1 THEN SYSUTCDATETIME() ELSE NULL END
          WHERE underwriting_case_id = @p0 AND step_no = @p1`,
        [caseId, 4, done ? ST.COMPLETED : ST.IN_PROGRESS, done ? 1 : 0]);
    }
  }
  await writeAudit(caseId, { stepNo, action: 'STEP_SAVED', req });
  return { ok: true };
}

/**
 * Date Sent to Solicitor changed on a case whose facility already exists: re-base the
 * loan start / maturity (liveLoan.ensure only rewrites a facility with no payments).
 */
async function syncLoanStart(caseId, req) {
  try {
    const r = await db.query(
      `SELECT uc.application_id FROM underwriting_cases uc
         JOIN loans l ON l.application_id = uc.application_id AND l.flag_deleted = 0
        WHERE uc.underwriting_case_id = @p0`, [caseId]);
    if (r.length) await liveLoan.ensure(r[0].application_id, req);
  } catch (e) {
    console.error('[underwriting] loan start not re-based for case ' + caseId + ': ' + e.message);
  }
}

/** Validate mandatory checklist items are all ticked in data.checklist. */
function checklistComplete(def, data) {
  if (!def.checklist || !def.checklist.length) return true;
  const checked = (data && data.checklist) || {};
  return def.checklist.every((item) => checked[item] === true);
}

/** Complete a step -> advance current_step, unlock next. Enforces sequence + mandatory. */
/**
 * Mirror underwriting step 3 (KYC / AML) onto the application record.
 *
 * The Application Detail screen has a "KYC / AML STATUS" card reading
 * applications.kyc_identity_status / kyc_aml_status / kyc_pep_status /
 * kyc_overall_status. Conversion seeds all four as 'Pending'
 * (enquiry.service convert) and nothing ever updated them again, so the card
 * stayed Pending forever even after the underwriter cleared KYC.
 *
 * Vocabulary matters here: 'Cleared' is the only value that satisfies BOTH
 * consumers - the credit policy checklist matches ['verified','complete',
 * 'cleared','clear'] exactly, and the UI chip greens on a 'clear' substring.
 */
/**
 * Real NVARCHAR widths for the columns that take FREE TEXT from the user.
 * notes / description / response / audit.reason are NVARCHAR(MAX) and cannot
 * truncate, but are still capped so one request cannot post a novel.
 *
 * These four CAN truncate, and did not check: an over-long value reached SQL
 * Server and came back as a raw error naming the database, table and column —
 * the same failure the enquiry and application modules hit.
 */
const LIMITS = {
  closed_reason: 500,   // underwriting_cases.closed_reason
  target_role: 50,      // underwriting_queries.target_role
  file_name: 255,       // underwriting_documents.file_name
  content_type: 120,    // underwriting_documents.content_type
  decision: 50,         // underwriting_steps.decision / cases.decision
  free_text: 4000,      // the NVARCHAR(MAX) columns — sanity cap only
};

/** Return an error message if the value is too long for its column. */
function overLimit(label, v, max) {
  return v != null && String(v).length > max
    ? `${label} must be ${max} characters or fewer (currently ${String(v).length})`
    : null;
}

const KYC_STEP_NO = 3;
const KYC_CHECKS = {
  identity: ['Valid ID checked', 'Proof of address checked'],
  aml: ['AML / Sanctions screening'],
  pep: ['PEP check'],
};

async function syncKycToApplication(caseId, data, decision, req) {
  const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
  const appId = cr[0] && cr[0].application_id;
  if (!appId) return;

  const ticks = (data && data.checklist) || {};
  const fields = (data && data.fields) || {};
  const anyTicked = Object.values(ticks).some((v) => v === true);
  const allTicked = (labels) => labels.every((l) => ticks[l] === true);

  const def = CFG.stepByNo(KYC_STEP_NO);
  const everyCheck = (def && def.checklist) || [];

  // The step-3 screen records its verdict as data.fields.kyc_result ('passed' /
  // 'failed') via the Mark Passed / Mark Failed buttons - NOT as a step decision
  // and NOT by ticking the checklist. That verdict is the underwriter's explicit
  // call, so it outranks everything else.
  const verdict = String(fields.kyc_result || '').toLowerCase();
  let overall;
  if (verdict === 'passed') overall = 'Cleared';
  else if (verdict === 'failed') overall = 'Failed';
  else if (decision === 'reject') overall = 'Failed';
  else if (decision === 'raise_query') overall = 'Pending — Query Raised';
  else if (decision === 'approve') overall = 'Cleared';
  else overall = everyCheck.length && allTicked(everyCheck) ? 'Cleared' : 'Pending';

  // When the underwriter cleared KYC as a whole without working through the
  // individual checkboxes, the per-line statuses follow the overall verdict.
  // Showing "Overall: Cleared" above "AML: Pending" would read as a fault.
  const sub = (labels) => {
    if (allTicked(labels)) return 'Cleared';
    if (!anyTicked && overall === 'Cleared') return 'Cleared';
    return 'Pending';
  };

  // A rejection fails the whole KYC block; otherwise each line stands on its tick.
  const failed = overall === 'Failed';
  await db.query(
    `UPDATE applications
        SET kyc_identity_status = @p1, kyc_aml_status = @p2, kyc_pep_status = @p3,
            kyc_overall_status = @p4, updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE application_id = @p0`,
    [appId,
     failed ? 'Failed' : sub(KYC_CHECKS.identity),
     failed ? 'Failed' : sub(KYC_CHECKS.aml),
     failed ? 'Failed' : sub(KYC_CHECKS.pep),
     overall, actorId(req)],
  ).catch(() => {});

  await writeAudit(caseId, { stepNo: KYC_STEP_NO, action: 'KYC_SYNCED_TO_APPLICATION', to: overall, req });
}

/**
 * Client 05-10-2026 (#13): is a step actually DONE, or merely proceeded past?
 * Proceeding never blocks; a step the underwriter skipped is left "pending"
 * (IN_PROGRESS) rather than marked Completed, so the stages bar shows it as
 * Pending and the final-step gate still requires it before Portfolio.
 */
/**
 * Client 16-10-2026: every active Solicitor Check (Masters > Solicitor Checks) must be ticked
 * on the Solicitor Quote step before it counts as done and before the credit paper can go to
 * the Final Credit Committee. Dual rep = our solicitor acts for both sides -> nothing to check.
 * `f` = step 4 fields. Returns { ok, missing: [check names] }.
 */
async function solicitorChecksStatus(f) {
  f = f || {};
  if (String(f.rep_type || '').toLowerCase() === 'dual') return { ok: true, missing: [] };
  const items = await db.query(
    'SELECT solicitor_check_item_id AS id, name FROM solicitor_check_items WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order, name',
  ).catch(() => []);
  const m = (f.sol_checks && typeof f.sol_checks === 'object') ? f.sol_checks : {};
  const missing = items.filter((it) => !(m[String(it.id)] && m[String(it.id)].done === true)).map((it) => it.name);
  return { ok: !missing.length, missing };
}

/** Same check, read from the case's saved Solicitor Quote step. */
async function caseSolicitorChecks(caseId) {
  const st = await loadStep(caseId, 4);
  return solicitorChecksStatus(((safeJson(st && st.data) || {}).fields) || {});
}

/** Step number as shown on the stepper (client 08-10-2026 order; 7-9 sit under Underwriting Review). */
function displayStepNo(no) {
  const map = { 2: 1, 4: 2, 3: 3, 6: 4, 7: 4, 8: 4, 9: 4 };
  return map[no] != null ? map[no] : (no >= 10 ? no - 5 : no);
}

async function isStepComplete(stepNo, data, caseId) {
  const f = (data && data.fields) || {};
  const entries = Array.isArray(f.entries) ? f.entries : [];
  const hasAccepted = entries.some((e) => e && e.status === 'accepted');
  switch (stepNo) {
    case 2: return hasAccepted || String(f.valuation_result || '') === 'accepted';
    case 3: return hasAccepted || String(f.kyc_result || '') === 'passed';
    // Client 16-10-2026: Solicitor Quote is done only when every Solicitor Check (Masters)
    // is ticked for the borrower's solicitor - dual rep has no borrower-solicitor checks.
    case 4: {
      const chosen = hasAccepted || !!String((f.our_solicitor && f.our_solicitor.firm_name) || f.firm_name || '').trim();
      return chosen && (await solicitorChecksStatus(f)).ok;
    }
    case 6: return !!String(f.recommendation == null ? '' : f.recommendation).trim();
    case 11: { const fa = Number(f.funds_amount || 0); return Number.isFinite(fa) && fa > 0; }
    case 8: {
      const docs = await db.query(
        `SELECT COUNT(*) AS n FROM underwriting_documents WHERE underwriting_case_id = @p0 AND step_no = 8 AND flag_deleted = 0`, [caseId]);
      return !!(docs.length && docs[0].n > 0);
    }
    default: return true;                                         // steps with no hard requirement
  }
}

async function completeStep(caseId, stepNo, body, req) {
  const def = CFG.stepByNo(stepNo);
  if (!def) return { ok: false, error: 'Unknown step' };
  if (!(await canActStep(def, req))) return { ok: false, forbidden: true };
  await ensureSteps(caseId, req);
  const cas = await db.query('SELECT current_step, status FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!cas.length) return { notFound: true };
  // Free-flow: any step may be completed at any stage (no sequence enforcement).
  const step = await loadStep(caseId, stepNo);
  if (!step) return { notFound: true };
  const data = body && body.data ? body.data : (step.data ? safeJson(step.data) : {});
  // Checklists are advisory (not mandatory) per business spec.

  // Step 6 (Underwrite & Findings): a recommendation must be chosen before
  // "Happy to Proceed" - the dropdown's empty value means "Not yet completed".
  if (stepNo === 6 && String((body && body.decision) || '') === 'proceed') {
    const rec = data && data.recommendation;
    if (!String(rec == null ? '' : rec).trim()) {
      return { ok: false, error: 'Choose a recommendation before proceeding - it is still "Not yet completed"' };
    }
  }

  // Valuation (2), KYC / AML (3), Solicitor Quote (4) — client 29-09-2026: several
  // entries may be added, but the step only completes once at least one is ACCEPTED
  // (the one(s) chosen). A verdict recorded the old way (Valuations module accept,
  // KYC Mark Passed) still counts.
  // Client 05-10-2026 (#13): intermediate steps are FREE-FLOW — you can proceed
  // without approving a valuation / KYC / solicitor first. All completeness is
  // checked once, at the final step (gate below), not on every "Proceed".


  // Client 21-10-2026: the last step is the highest step NUMBER (12, Completion), not the
  // count of steps - config has no step 5, so STEPS.length (11) made "Confirm Funds Sent"
  // run the Portfolio gate (bogus "Step 2 KYC / AML" error) and left Completion ungated.
  const isLast = stepNo === Math.max(...CFG.STEPS.map((s) => s.no));
  // Final step gate ONLY (client 05-10-2026 #13): every working step (2..last-1) must be
  // Completed/Approved/Skipped before the case can move to Portfolio. Intermediate steps
  // are not gated — the underwriter moves through them freely; the check happens here, once.
  if (isLast) {
    const pending = await db.query(
      `SELECT step_no, step_key FROM underwriting_steps
        WHERE underwriting_case_id = @p0 AND step_no > 1 AND step_no < @p1
          AND status NOT IN (@p2, @p3, @p4)
        ORDER BY step_no`,
      [caseId, stepNo, ST.COMPLETED, ST.APPROVED, ST.SKIPPED]);
    // Valuation (2) and KYC/AML (3) are VERDICT steps: a saved form is not enough, the
    // valuation must be accepted and KYC marked passed (same rule the detail stepper uses).
    const verdicts = await db.query(
      `SELECT step_no, step_key, status, data FROM underwriting_steps
        WHERE underwriting_case_id = @p0 AND step_no IN (2, 3)`, [caseId]);
    for (const v of verdicts) {
      // Client 23-10-2026: a verdict step whose verdict is in (valuation accepted / KYC
      // passed) is Done on the stepper even if "Proceed" was never clicked on it (status
      // still In Progress) - don't block Portfolio for it ("Step 3 KYC / AML" while Done).
      const verdictOk = v.status !== ST.SKIPPED && await isStepComplete(v.step_no, safeJson(v.data) || {}, caseId);
      if (verdictOk) {
        const at = pending.findIndex((p) => p.step_no === v.step_no);
        if (at >= 0) pending.splice(at, 1);
        continue;
      }
      if (pending.some((p) => p.step_no === v.step_no)) continue;
      // Client 20-10-2026: same rule as isStepComplete / the stages bar - an ACCEPTED entry
      // (multi-valuation / multi-KYC, client 29-09-2026) counts, not only the old single
      // valuation_result / kyc_result field. The old check ignored entries, so a step shown
      // "Done" still blocked Portfolio with "Step 1 Valuation Instruction".
      const ok = await isStepComplete(v.step_no, safeJson(v.data) || {}, caseId);
      if (!ok && v.status !== ST.SKIPPED) pending.push({ step_no: v.step_no, step_key: v.step_key });
    }
    pending.sort((a, b) => a.step_no - b.step_no);
    if (pending.length) {
      // Same numbering as the stepper on screen (Valuation 1, Solicitor Quote 2, KYC 3, ...).
      const label = (p) => { const d = CFG.stepByNo(p.step_no); return `Step ${displayStepNo(p.step_no)} ${d ? d.name : p.step_key}`; };
      return { ok: false, error: 'Complete all steps before moving to Portfolio: ' + pending.map(label).join(', ') };
    }
  }
  // Client 20-10-2026: "Agree to Fund" needs Roles > Final Credit Committee > APPROVE.
  if (def.key === 'credit_committee' && !(await canCommittee(req, 'approve'))) return { ok: false, forbidden: true };
  // Client 16-10-2026: the committee cannot agree to fund while a solicitor check is open.
  if (def.key === 'credit_committee') {
    const sc = await caseSolicitorChecks(caseId);
    if (!sc.ok) return { ok: false, error: 'Complete all Solicitor Checks (Step 2 Solicitor Quote) first: ' + sc.missing.join(', ') };
  }
  const stepComplete = await isStepComplete(stepNo, data, caseId);
  await db.query(
    `UPDATE underwriting_steps SET status = @p2, data = @p3, decision = @p4,
            completed_at = CASE WHEN @p6 = 1 THEN SYSUTCDATETIME() ELSE NULL END,
            updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE underwriting_case_id = @p0 AND step_no = @p1`,
    [caseId, stepNo, stepComplete ? ST.COMPLETED : ST.IN_PROGRESS, JSON.stringify(data),
     body && body.decision ? String(body.decision) : null, actorId(req), stepComplete ? 1 : 0]);

  if (def.key === 'funds_completion') await syncLoanStart(caseId, req);
  // Client 15-10-2026: keep the APPLICATION status in step with underwriting - a deal
  // accepted and moved to Portfolio was still listed as "Credit Review".
  //   Final Credit Committee agreed -> Approved;  moved to Portfolio -> Completed.
  // (Funds to Solicitor / Completion also imply the committee has agreed - never leave
  //  the application behind at Credit Review once the case is past the committee.)
  if (stepComplete && ['credit_committee', 'funds_completion'].includes(def.key)) {
    const cr0 = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
    if (cr0[0] && cr0[0].application_id) await setAppStatusForward(cr0[0].application_id, 'APPROVED', req);
  }
  if (String(cas[0].status) === S.IN_PORTFOLIO) {
    // Case already moved to Portfolio (e.g. before the gate above existed): let a missed step be
    // finished for the record without re-opening the case or changing the application status.
    if (stepNo === KYC_STEP_NO) await syncKycToApplication(caseId, data, body && body.decision ? String(body.decision) : null, req);
    await writeAudit(caseId, { stepNo, action: 'STEP_COMPLETED_AFTER_PORTFOLIO', to: ST.COMPLETED, req });
    return { ok: true, done: true };
  }

  if (isLast) {
    const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
    const appId = cr[0] && cr[0].application_id;
    if (appId) {
      const made = await liveLoan.ensure(appId, req);
      if (!made.ok) return made;
    }
    await db.query(`UPDATE underwriting_cases SET status = @p1, current_step = @p2, updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0`,
      [caseId, S.IN_PORTFOLIO, stepNo, actorId(req)]);
    await writeAudit(caseId, { stepNo, action: 'CASE_MOVED_TO_PORTFOLIO', from: ST.IN_PROGRESS, to: S.IN_PORTFOLIO, req });
    if (appId) await setAppStatus(appId, 'COMPLETED', req);
    return { ok: true, done: true };
  }
  // Client 07-10-2026: Solicitor Quote (4) is presented before KYC/AML (3). Stored
  // step numbers are unchanged; only the ORDER through them swaps 3<->4.
  const UW_SEQUENCE = [1, 2, 4, 3, 6, 7, 8, 9, 10, 11, 12];
  const seqIdx = UW_SEQUENCE.indexOf(stepNo);
  let next = seqIdx >= 0 && seqIdx < UW_SEQUENCE.length - 1 ? UW_SEQUENCE[seqIdx + 1] : stepNo + 1;
  // Step 6 (Underwrite & Findings): "Happy to Proceed" (proceed) skips Credit Discussion
  // (step 7) -> Draft Legal (step 8); "Refer to Credit" (refer_credit) goes to step 7.
  if (stepNo === 6 && body && String(body.decision) === 'proceed') {
    next = 8;
    await db.query(`UPDATE underwriting_steps SET status = @p2, completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND step_no = @p1`,
      [caseId, 7, ST.SKIPPED]);
  }
  // Hand off to the Credit Approval module: completing Underwrite & Findings (step 6)
  // with proceed / refer-to-credit moves the application into the credit queue
  // (additive; the underwriting case keeps its own steps/lifecycle).
  if (stepNo === 6 && body && ['proceed', 'refer_credit'].includes(String(body.decision))) {
    const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
    const appId = cr[0] && cr[0].application_id;
    if (appId) {
      const recLabel = String(body.decision) === 'proceed' ? 'Proceed' : 'Refer to Credit';
      await db.query('UPDATE applications SET uw_recommendation = @p1 WHERE application_id = @p0', [appId, recLabel]).catch(() => {});
      await setAppStatusForward(appId, 'UNDERWRITING', req); // Credit Review stage retired (client 15-10-2026): stays in Underwriting until the committee approves
    }
  }
  await db.query(`UPDATE underwriting_steps SET status = @p2, started_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND step_no = @p1 AND status = @p3`,
    [caseId, next, ST.IN_PROGRESS, ST.LOCKED]);
  // Advance current_step along the UW SEQUENCE, not by raw number: Solicitor Quote (4)
  // comes BEFORE KYC/AML (3), so a numeric "next > current_step" test wrongly treated
  // 4 -> 3 as going backward and left the case stuck on Solicitor Quote (client 10-10-2026).
  // Compare sequence positions so the case always moves to the next step in the flow.
  const seqPos = (n) => { const i = UW_SEQUENCE.indexOf(Number(n)); return i < 0 ? 999 : i; };
  const curStepNow = Number(cas[0].current_step) || 1;
  const advanceTo = seqPos(next) > seqPos(curStepNow) ? next : curStepNow;
  await db.query(`UPDATE underwriting_cases SET current_step = @p1, status = @p2, updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0`,
    [caseId, advanceTo, S.IN_PROGRESS, actorId(req)]);
  if (stepNo === KYC_STEP_NO) {
    await syncKycToApplication(caseId, data, body && body.decision ? String(body.decision) : null, req);
  }
  await writeAudit(caseId, { stepNo, action: 'STEP_COMPLETED', to: ST.COMPLETED, req });
  return { ok: true, next };
}

/**
 * The Credit module has decided on an application — reflect it on the
 * underwriting case's Credit Discussion step (config step 7), which is the step
 * the case sits on while Credit has it.
 *
 *   approve / approve_conditions -> step Completed, decision 'proceed', case
 *                                   moves on to the next step (Draft Legal)
 *   decline                      -> step Rejected, decision 'cannot_proceed',
 *                                   case Rejected with the credit notes as the
 *                                   reason (the step's own "cannot proceed" path)
 *   refer                        -> nothing is completed; the credit note is
 *                                   recorded on the step for the underwriter
 *
 * Best-effort: a credit decision is never blocked by this. Called from
 * credit.service.decide().
 */
const CREDIT_DISCUSSION_STEP = 7;

async function applyCreditDecision(applicationId, decision, notes, req) {
  try {
    const cases = await db.query(
      `SELECT TOP 1 underwriting_case_id AS id, status FROM underwriting_cases
        WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY underwriting_case_id DESC`, [applicationId]);
    if (!cases.length) return { ok: true, skipped: 'no case' };
    const caseId = cases[0].id;
    const status = String(cases[0].status || '');
    // A case already closed, rejected or handed to Portfolio is left alone.
    if ([S.CLOSED, S.REJECTED, S.IN_PORTFOLIO].includes(status)) return { ok: true, skipped: 'case ' + status };

    await ensureSteps(caseId, req);
    const stepNo = CREDIT_DISCUSSION_STEP;
    const st = await loadStep(caseId, stepNo);
    const data = (st && st.data ? safeJson(st.data) : {}) || {};
    data.fields = data.fields || {};
    data.fields.credit_decision = decision;
    if (notes) data.fields.notes = [data.fields.notes, `Credit: ${notes}`].filter(Boolean).join('\n');
    data.fields.credit_decided_at = new Date().toISOString();

    if (decision === 'refer') {
      await db.query(
        `UPDATE underwriting_steps SET data = @p2, updated_at = SYSUTCDATETIME()
          WHERE underwriting_case_id = @p0 AND step_no = @p1`, [caseId, stepNo, JSON.stringify(data)]);
      await writeAudit(caseId, { stepNo, action: 'CREDIT_REFERRED_BACK', to: 'refer', req });
      return { ok: true, referred: true };
    }

    if (decision === 'decline') {
      await db.query(
        `UPDATE underwriting_steps SET status = @p2, decision = 'cannot_proceed', data = @p3,
                completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
          WHERE underwriting_case_id = @p0 AND step_no = @p1`, [caseId, stepNo, ST.REJECTED, JSON.stringify(data)]);
      await db.query(
        `UPDATE underwriting_cases SET status = @p1, decision = 'cannot_proceed', closed_reason = @p2,
                updated_at = SYSUTCDATETIME()
          WHERE underwriting_case_id = @p0`,
        [caseId, S.REJECTED, String(notes || 'Declined by Credit').slice(0, 500)]);
      await writeAudit(caseId, { stepNo, action: 'CASE_REJECTED_BY_CREDIT', to: S.REJECTED, req, reason: notes || null });
      return { ok: true, rejected: true };
    }

    // approve / approve_conditions
    await db.query(
      `UPDATE underwriting_steps SET status = @p2, decision = 'proceed', data = @p3,
              completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
        WHERE underwriting_case_id = @p0 AND step_no = @p1`, [caseId, stepNo, ST.COMPLETED, JSON.stringify(data)]);
    const next = stepNo + 1;
    await db.query(
      `UPDATE underwriting_steps SET status = @p2, started_at = COALESCE(started_at, SYSUTCDATETIME()), updated_at = SYSUTCDATETIME()
        WHERE underwriting_case_id = @p0 AND step_no = @p1 AND status = @p3`,
      [caseId, next, ST.AVAILABLE, ST.LOCKED]);
    await db.query(
      `UPDATE underwriting_cases SET status = @p1, current_step = @p2, updated_at = SYSUTCDATETIME()
        WHERE underwriting_case_id = @p0`, [caseId, S.IN_PROGRESS, next]);
    await writeAudit(caseId, { stepNo, action: 'CREDIT_APPROVED', to: ST.COMPLETED, req });
    return { ok: true, approved: true, next };
  } catch (e) {
    console.error('[underwriting] applyCreditDecision failed for application ' + applicationId + ': ' + e.message);
    return { ok: false, error: e.message };
  }
}

/** Decision on a step: reject (needs reason) / proceed / refer_credit / cannot_proceed. */
async function decide(caseId, stepNo, body, req) {
  const def = CFG.stepByNo(stepNo);
  if (!def) return { ok: false, error: 'Unknown step' };
  if (!(await canActStep(def, req))) return { ok: false, forbidden: true };
  await ensureSteps(caseId, req);
  const decision = String(body && body.decision || '').trim();
  if (!decision) return { ok: false, error: 'A decision is required' };
  const reason = body && body.reason ? String(body.reason) : null;

  // closed_reason is NVARCHAR(500): refuse an over-long reason rather than
  // letting SQL Server abort the write with a truncation error.
  const badDecision = overLimit('Decision', decision, LIMITS.decision);
  if (badDecision) return { ok: false, error: badDecision, errors: { decision: badDecision } };
  const badReason = overLimit('Reason', reason, LIMITS.closed_reason);
  if (badReason) return { ok: false, error: badReason, errors: { reason: badReason } };

  if (decision === 'reject' || decision === 'cannot_proceed') {
    // Client 20-10-2026: "Cannot Proceed - Close" needs Roles > Final Credit Committee > REJECT.
    if (def.key === 'credit_committee' && !(await canCommittee(req, 'reject'))) return { ok: false, forbidden: true };
    if (!reason) return { ok: false, error: 'A reason is required to reject / close' };
    // Final Credit Committee decline closes the file (inform broker + solicitor); others reject.
    const closes = def.key === 'credit_committee';
    const caseStatus = closes ? S.CLOSED : S.REJECTED;
    await db.query(`UPDATE underwriting_steps SET status = @p2, decision = @p3, completed_at = SYSUTCDATETIME(), updated_by = @p4, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND step_no = @p1`,
      [caseId, stepNo, ST.REJECTED, decision, actorId(req)]);
    await db.query(`UPDATE underwriting_cases SET status = @p1, decision = @p2, closed_reason = @p3, updated_by = @p4, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0`,
      [caseId, caseStatus, decision, reason, actorId(req)]);
    await writeAudit(caseId, { stepNo, action: closes ? 'CASE_CLOSED_AT_COMMITTEE' : 'CASE_REJECTED', to: caseStatus, req, reason });
    // Application follows the case (client 15-10-2026): rejected / closed -> Declined.
    {
      const crx = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
      if (crx[0] && crx[0].application_id) await setAppStatus(crx[0].application_id, 'DECLINED', req);
    }
    if (stepNo === KYC_STEP_NO) await syncKycToApplication(caseId, {}, 'reject', req);
    return { ok: true, rejected: !closes, closed: closes };
  }
  // proceed / refer_credit -> record decision, complete step (advance handled by completeStep call from controller if desired)
  await db.query(`UPDATE underwriting_steps SET decision = @p2, updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND step_no = @p1`,
    [caseId, stepNo, decision, actorId(req)]);
  await writeAudit(caseId, { stepNo, action: 'STEP_DECISION', to: decision, req, reason });

  if (stepNo === KYC_STEP_NO) {
    const st = await loadStep(caseId, stepNo);
    await syncKycToApplication(caseId, st && st.data ? safeJson(st.data) : {}, decision, req);
  }

  // Hand off to the Credit Approval module: a proceed / refer-to-credit decision at
  // the Underwrite & Findings step moves the application into the credit queue
  // (additive; the underwriting case + its own steps are unchanged).
  if (def.key === 'underwrite_findings' && (decision === 'proceed' || decision === 'refer_credit')) {
    const caseRow = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
    const appId = caseRow[0] && caseRow[0].application_id;
    if (appId) {
      const recLabel = decision === 'proceed' ? 'Proceed' : 'Refer to Credit';
      await db.query('UPDATE applications SET uw_recommendation = @p1 WHERE application_id = @p0', [appId, recLabel]).catch(() => {});
      await setAppStatusForward(appId, 'UNDERWRITING', req); // Credit Review stage retired (client 15-10-2026): stays in Underwriting until the committee approves
    }
  }
  return { ok: true, decision };
}

/* ------------------------------------------------------------------ */
/*  QUERIES / request information                                     */
/* ------------------------------------------------------------------ */

/**
 * Request Info e-mail (client 09-10-2026): the underwriter's "Request Info" now actually
 * EMAILS the chosen recipient (BDM / Broker / Applicant), not just records a query.
 *  - lists BOTH / all security properties on the case (task 1)
 *  - when it is sent to the Broker, the BDM is automatically cc'd (task 7); the BDM is also
 *    cc'd for an Applicant send, mirroring the enquiry behaviour.
 * Best-effort: a mail failure never blocks the query itself.
 */
async function sendRequestInfoEmail(caseId, opts, req) {
  const sendTo = String((opts && opts.send_to) || '').trim();
  const rows = await db.query(
    `SELECT a.application_id, a.application_ref, a.enquiry_id,
            COALESCE(a.broker_id, e.broker_id) AS broker_id,
            COALESCE(NULLIF(br.company,''), br.name, NULLIF(ebr.company,''), ebr.name) AS broker_name,
            COALESCE(br.email, ebr.email) AS broker_email,
            bdm.full_name AS bdm_name, bdm.email AS bdm_email,
            ap.first_name, ap.last_name, ap.company_name, ap.email AS applicant_email,
            e.property_address AS enquiry_property_address
       FROM underwriting_cases uc
       LEFT JOIN applications a ON a.application_id = uc.application_id
       LEFT JOIN brokers br ON br.broker_id = a.broker_id
       LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
       LEFT JOIN brokers ebr ON ebr.broker_id = e.broker_id
       LEFT JOIN users bdm ON bdm.user_id = a.assigned_to
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0`, [caseId]);
  if (!rows.length) return { ok: false, error: 'Case not found' };
  const c = rows[0];

  const borrower = c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'the applicant';
  const ref = c.application_ref || ('APP-' + c.application_id);

  const targets = {
    'BDM / Sales': { email: c.bdm_email, name: c.bdm_name || 'BDM' },
    Broker: { email: c.broker_email, name: c.broker_name || 'Broker' },
    Applicant: { email: c.applicant_email, name: borrower },
  };
  const target = targets[sendTo];
  if (!target) return { ok: false, error: 'Choose who to send the request to' };
  if (!target.email || !String(target.email).includes('@')) {
    return { ok: false, error: `No email address on file for the ${sendTo}` };
  }

  // Every security property on the case (both / all), de-duplicated.
  const secRows = await db.query(
    `SELECT property_address FROM application_security
      WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id`, [c.application_id]);
  const addrs = [];
  const seen = new Set();
  const pushAddr = (v) => {
    const t = String(v == null ? '' : v).trim();
    if (!t) return; const k = t.toUpperCase().replace(/\s/g, '');
    if (seen.has(k)) return; seen.add(k); addrs.push(t);
  };
  secRows.forEach((r) => pushAddr(r.property_address));
  if (!addrs.length) pushAddr(c.enquiry_property_address);

  const esc = (t) => String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const items = Array.isArray(opts && opts.items) ? opts.items.map((x) => String(x)).filter(Boolean) : [];
  const comments = opts && opts.comments ? String(opts.comments).trim() : '';
  const dueDate = opts && opts.due_date ? String(opts.due_date).slice(0, 10) : '';

  const secHtml = addrs.length > 1
    ? `<p><strong>Security addresses:</strong></p><ul>${addrs.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
    : `<p><strong>Security address:</strong> ${esc(addrs[0] || '—')}</p>`;
  const list = items.length
    ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '<p>No specific items were listed.</p>';
  // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
  const mailVars = {
    Ref: ref, Borrower: borrower, SecurityAddress: addrs.join('; '), RecipientName: target.name,
    RequestedItems: items.join(', '), DueDate: dueDate, Notes: comments,
    SecurityBlock: secHtml, RequestedItemsList: list,
    DueDateBlock: dueDate ? `<p><strong>Please respond by:</strong> ${esc(dueDate)}</p>` : '',
    NotesBlock: comments ? `<p><strong>Notes:</strong><br>${esc(comments).replace(/\n/g, '<br>')}</p>` : '',
  };
  const { subject: mailSubject, html } = emailHub.render('UW_INFO_REQUEST', mailVars);

  // cc the BDM whenever the request is NOT addressed to the BDM (client 09-10-2026: a
  // request to the broker always copies the BDM in).
  const ccList = (c.bdm_email && String(c.bdm_email).toLowerCase() !== String(target.email || '').toLowerCase())
    ? [c.bdm_email] : [];

  const res = await mail.sendMail({
    to: target.email,
    cc: ccList,
    subject: mailSubject,
    html,
    // Email Settings master + Email History (client 17-10-2026)
    event: 'UW_INFO_REQUEST', ref: { module: 'UNDERWRITING', id: caseId, number: ref }, req, vars: mailVars,
  });
  const ok = !!(res && res.ok !== false);
  await writeAudit(caseId, {
    action: ok ? 'INFO_REQUEST_EMAILED' : 'INFO_REQUEST_EMAIL_FAILED',
    to: target.email + (ccList.length ? ' (cc ' + ccList[0] + ')' : ''), req,
  }).catch(() => {});
  return ok
    ? { ok: true, to: target.email, cc: ccList }
    : { ok: false, error: (res && res.error) || 'send failed' };
}

async function raiseQuery(caseId, body, req) {
  const desc = String(body && body.description || '').trim();
  const badDesc = overLimit('Description', desc, LIMITS.free_text);
  if (badDesc) return { ok: false, error: badDesc, errors: { description: badDesc } };
  const targetRole = body && body.target_role ? String(body.target_role) : null;
  const badRole = overLimit('Responsible role', targetRole, LIMITS.target_role);
  if (badRole) return { ok: false, error: badRole, errors: { target_role: badRole } };
  if (!desc) return { ok: false, error: 'Query description is required' };
  if (!body || (!body.target_role && !int(body.target_user))) return { ok: false, error: 'A responsible role or user is required' };
  const stepNo = int(body.step_no);
  const out = await db.query(
    `INSERT INTO underwriting_queries (underwriting_case_id, step_no, raised_by, target_role, target_user, description, status, created_by)
     OUTPUT INSERTED.underwriting_query_id AS id VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p2)`,
    [caseId, stepNo, actorId(req), targetRole, int(body.target_user), desc, 'Open']);
  if (stepNo) await db.query(`UPDATE underwriting_steps SET status = @p2 WHERE underwriting_case_id = @p0 AND step_no = @p1`, [caseId, stepNo, ST.QUERY]);
  await db.query(`UPDATE underwriting_cases SET status = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0`, [caseId, S.PENDING_INFO, actorId(req)]);
  await writeAudit(caseId, { stepNo, action: 'QUERY_RAISED', to: S.PENDING_INFO, req, reason: desc });
  // Client 09-10-2026: also EMAIL the chosen recipient (BDM / Broker / Applicant). Best-effort —
  // a mail failure must not fail the query. `email_sent` tells the UI whether the mail went.
  let emailOut = { ok: false, skipped: true };
  if (['BDM / Sales', 'Broker', 'Applicant'].includes(String(targetRole))) {
    try {
      emailOut = await sendRequestInfoEmail(caseId, {
        send_to: targetRole,
        items: body && body.items,
        comments: body && body.comments,
        due_date: body && body.due_date,
      }, req);
    } catch (e) { emailOut = { ok: false, error: e && e.message }; console.error('[underwriting] request-info email failed for case ' + caseId + ': ' + (e && e.message)); }
  }
  return { ok: true, id: out[0].id, email_sent: !!emailOut.ok, email_to: emailOut.to || null, email_error: emailOut.ok ? null : (emailOut.error || null) };
}

async function respondQuery(caseId, queryId, body, req) {
  const resp = String(body && body.response || '').trim();
  const badResp = overLimit('Response', resp, LIMITS.free_text);
  if (badResp) return { ok: false, error: badResp, errors: { response: badResp } };
  if (!resp) return { ok: false, error: 'A response is required' };
  const rows = await db.query('SELECT step_no FROM underwriting_queries WHERE underwriting_query_id = @p0 AND underwriting_case_id = @p1', [queryId, caseId]);
  if (!rows.length) return { notFound: true };
  await db.query(`UPDATE underwriting_queries SET response = @p2, status = 'Resolved', responded_by = @p3, responded_at = SYSUTCDATETIME(), updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_query_id = @p0 AND underwriting_case_id = @p1`,
    [caseId, queryId, resp, actorId(req)]);
  const stepNo = rows[0].step_no;
  if (stepNo) await db.query(`UPDATE underwriting_steps SET status = @p2 WHERE underwriting_case_id = @p0 AND step_no = @p1 AND status = @p3`, [caseId, stepNo, ST.IN_PROGRESS, ST.QUERY]);
  const open = await db.query(`SELECT COUNT(*) AS n FROM underwriting_queries WHERE underwriting_case_id = @p0 AND status = 'Open'`, [caseId]);
  if (!open[0].n) await db.query(`UPDATE underwriting_cases SET status = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0 AND status = @p3`, [caseId, S.IN_PROGRESS, actorId(req), S.PENDING_INFO]);
  await writeAudit(caseId, { stepNo, action: 'QUERY_RESOLVED', req, reason: resp });
  return { ok: true };
}

function safeJson(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

const VALUER_FIRMS = ['Knight Frank LLP', 'Savills', 'CBRE', 'JLL', 'Allsop'];
const VALUATION_TYPE_FALLBACK = ['RICS Red Book', 'Development Appraisal', 'Desktop', 'AVM', 'VAS — Full Valuation'];
const asOpts = (arr) => arr.map((n, i) => ({ id: i + 1, name: n }));

async function stageCounts(opts = {}) {
  // The chips must count exactly what the list will show, so the same view
  // scope is applied here (own cases + anything not yet accepted).
  const uid = int(opts.scopeUserId);
  const scope = uid ? ' AND (underwriter_id = @p0 OR underwriter_id IS NULL)' : '';
  const args = uid ? [uid] : [];
  const active = await db.query(
    `SELECT current_step, COUNT(*) AS n FROM underwriting_cases
      WHERE flag_deleted = 0 AND status IN ('In Progress','Pending Information','Ready to Proceed')${scope}
      GROUP BY current_step`, args);
  const byStep = {};
  for (const r of active) byStep[r.current_step] = r.n;
  const one = async (q) => (((await db.query(q, args)) || [])[0] || {}).n || 0;
  const credit = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status = 'Sent to Credit'${scope}`);
  const awaiting = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status = 'New Review'${scope}`);
  const total = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status NOT IN ('Rejected','Closed','In Portfolio','On Hold','Returned to BDM')${scope}`);
  const portfolio = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status = 'In Portfolio'${scope}`);
  // Finished cases (declined + closed) — hidden by the default Live view, shown by the Declined/Closed chip.
  const closed = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status IN ('Rejected','Closed')${scope}`);
  const returned = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status = 'Returned to BDM'${scope}`);
  const onhold = await one(`SELECT COUNT(*) AS n FROM underwriting_cases WHERE flag_deleted = 0 AND status = 'On Hold'${scope}`);
  return { byStep, credit, awaiting, total, portfolio, closed, returned, onhold };
}

async function meta() {
  let [valuationTypes, brokers, solicitors, valuers, kycUsers, kycChecks, solicitorChecks, solicitorCostTypes, borrowerSolicitors] = await Promise.all([
    db.query("SELECT valuation_type_id AS id, name FROM valuation_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name").catch(() => null),
    db.query("SELECT broker_id AS id, COALESCE(NULLIF(company,''), name) AS name FROM brokers WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name"),
    db.query("SELECT solicitor_id AS id, COALESCE(NULLIF(firm,''), name) AS name, name AS sol_name, firm, email, phone FROM solicitors WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name"),
    db.query("SELECT valuer_firm_id AS id, name, firm, email, phone FROM valuer_firms WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name").catch(() => null),
    db.query("SELECT user_id AS id, full_name AS name FROM users WHERE flag_deleted = 0 AND is_active = 1 ORDER BY full_name"),
    // KYC check master (client 07-10-2026): the checks the underwriter must run,
    // typed by applicant type (Individual / Company). Drives the KYC / AML step.
    db.query(`SELECT k.kyc_check_item_id AS id, k.name, at.name AS applicant_type, k.sort_order
                FROM kyc_check_items k
                LEFT JOIN applicant_types at ON at.applicant_type_id = k.applicant_type_id
               WHERE k.flag_deleted = 0 AND k.is_active = 1
               ORDER BY at.name, k.sort_order, k.name`).catch(() => []),
    // Solicitor check master (client 07-10-2026): checks on the borrower's solicitor.
    db.query(`SELECT solicitor_check_item_id AS id, name, sort_order FROM solicitor_check_items
               WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order, name`).catch(() => []),
    // Client 16-10-2026: Additional-cost names (Masters > Solicitor Cost Types).
    db.query(`SELECT solicitor_cost_type_id AS id, name, sort_order FROM solicitor_cost_types
               WHERE flag_deleted = 0 AND is_active = 1 ORDER BY ISNULL(sort_order, 9999), name`).catch(() => []),
    // Client 16-10-2026: Borrower's Solicitor master for the Solicitor Quote dropdown.
    db.query(`SELECT borrower_solicitor_id AS id, firm_name AS name, firm_name, contact_name, address, telephone, email, sra_no
                FROM borrower_solicitors WHERE flag_deleted = 0 AND is_active = 1 ORDER BY firm_name`)
      .catch(() => db.query(`SELECT borrower_solicitor_id AS id, firm_name AS name, firm_name, contact_name, address, telephone, email
                FROM borrower_solicitors WHERE flag_deleted = 0 AND is_active = 1 ORDER BY firm_name`).catch(() => [])),
  ]);
  // Hard-coded lists only when the master table is missing (query failed).
  // An empty result means every row was deactivated -> show nothing.
  if (!valuationTypes) valuationTypes = asOpts(VALUATION_TYPE_FALLBACK);
  if (!valuers) valuers = asOpts(VALUER_FIRMS);
  // Head of Underwriting users = default recipients offered in the Final Credit Committee
  // "Send Credit Paper" popup (client 09-10-2026).
  let committeeHeads = [];
  try { committeeHeads = (await dealSummary.headOfUnderwritingUsers()).map((h) => ({ id: h.user_id, name: h.full_name, email: h.email })); }
  catch { committeeHeads = []; }
  return { steps: CFG.STEPS, caseStatus: CFG.CASE_STATUS, stepStatus: CFG.STEP_STATUS, slaDays: CFG.SLA_DAYS,
    options: { valuationTypes, brokers, solicitors, valuers, kycUsers, kycChecks, solicitorChecks, committeeHeads, solicitorCostTypes, borrowerSolicitors } };
}


/** Review-stage REJECT (from the New Review banner). Requires reason. */
async function rejectCase(id, body, req) {
  const reason = body && body.reason ? String(body.reason).trim() : '';
  if (!reason) return { ok: false, error: 'A reason is required to reject' };
  const badReason = overLimit('Reason', reason, LIMITS.closed_reason);
  if (badReason) return { ok: false, error: badReason, errors: { reason: badReason } };
  const blocked = await reviewGuard(id, 'rejected');
  if (blocked) return blocked;
  const rows = await db.query('SELECT status, application_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [id]);
  if (!rows.length) return { notFound: true };
  const from = rows[0].status;
  await db.query('UPDATE underwriting_cases SET status = @p1, decision = @p2, closed_reason = @p3, updated_by = @p4, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0',
    [id, S.REJECTED, 'reject', reason, actorId(req)]);
  await setAppStatus(rows[0].application_id, 'DECLINED', req);
  await writeAudit(id, { action: 'CASE_REJECTED_REVIEW', from, to: S.REJECTED, req, reason });
  return { ok: true };
}

/** Review-stage RETURN TO BDM. Sends the application back to DRAFT; case parked (Closed). */
async function returnToBdm(id, body, req) {
  const note = body && body.note ? String(body.note).trim() : '';
  const badNote = overLimit('Note', note, LIMITS.closed_reason);
  if (badNote) return { ok: false, error: badNote, errors: { note: badNote } };
  // Client 28-09-2026: the underwriter can return the case to the BDM at ANY step,
  // not only from New Review. Only finished cases (in portfolio, rejected, already
  // returned / closed) are refused.
  const rows = await db.query('SELECT status, application_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [id]);
  if (!rows.length) return { notFound: true };
  const from = rows[0].status;
  if ([S.IN_PORTFOLIO, S.REJECTED, S.CLOSED, S.RETURNED_TO_BDM].includes(String(from))) {
    const what = String(from) === S.IN_PORTFOLIO ? 'already moved to Portfolio'
      : String(from) === S.REJECTED ? 'already rejected' : 'already returned to the BDM / closed';
    return { ok: false, error: `This case was ${what}, so it can no longer be returned to the BDM. Refresh to see its current state.` };
  }
  const appId = rows[0].application_id;
  await db.query('UPDATE underwriting_cases SET status = @p1, closed_reason = @p2, updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0',
    [id, S.RETURNED_TO_BDM, note || 'Returned to BDM', actorId(req)]);

  // Client 06-10-2026: the return now flows all the way back to the ORIGINATING
  // ENQUIRY at the Send-Offer stage - not just the application to DRAFT. The BDM
  // revises / re-sends the offer on the enquiry and converts again. The old
  // application and its (now closed) case are logically dropped so the enquiry can
  // be re-converted without leaving a duplicate application behind.
  const appRow = (await db.query('SELECT enquiry_id, application_ref FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [appId]))[0] || {};
  const enquiryId = appRow.enquiry_id || null;
  if (enquiryId) {
    await db.query('UPDATE applications SET flag_deleted = 1, updated_by = @p1, updated_at = SYSUTCDATETIME() WHERE application_id = @p0', [appId, actorId(req)]);
    await db.query('UPDATE underwriting_cases SET flag_deleted = 1, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0', [id]);
    // un-convert the enquiry and send it back to the offer stage (forward-only graph, so force)
    await db.query('UPDATE enquiries SET converted_application_id = NULL, converted_at = NULL, updated_by = @p1, updated_at = SYSUTCDATETIME() WHERE enquiry_id = @p0', [enquiryId, actorId(req)]);
    try {
      await workflow.applyStatus(enquiryId, workflow.S.QUALIFIED, req, { force: true, reason: 'Returned from underwriting to revise the offer' });
    } catch (e) { /* status move is best-effort; the un-convert above is what reopens the enquiry */ }
    // Communications / mail-log trail on the enquiry so the round-trip is visible.
    await enquirySvc.addNote(enquiryId,
      `Returned from underwriting (application ${appRow.application_ref || appId}) to revise the offer${note ? ': ' + note : ''}`,
      req).catch(() => {});
  } else {
    // No originating enquiry (manually-created application) - keep the old behaviour.
    await setAppStatus(appId, 'DRAFT', req);
  }
  await writeAudit(id, { action: 'CASE_RETURNED_TO_BDM', from, to: S.RETURNED_TO_BDM, req, reason: note });
  return { ok: true, returnedToEnquiry: !!enquiryId, enquiryId };
}

const UW_DOC_DIR = path.join('uploads', 'underwriting_documents');

/** Upload a photo/document to a case + step (base64 JSON body). */
async function addPhoto(caseId, stepNo, body, req) {
  const exists = await db.query('SELECT 1 FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!exists.length) return { notFound: true };
  const name = String((body && body.file_name) || '').trim();
  const b64 = String((body && body.content_base64) || '');
  if (!name || !b64) return { ok: false, error: 'file_name and content_base64 are required' };
  const badName = overLimit('File name', name, LIMITS.file_name);
  if (badName) return { ok: false, error: badName, errors: { file_name: badName } };
  let ctype = (String(b64).match(/^data:([^;]+);base64,/) || [])[1] || (body && body.content_type) || 'application/octet-stream';
  // A media type is never legitimately this long; clamp rather than reject, as
  // the browser supplies it and the user cannot correct it.
  if (String(ctype).length > LIMITS.content_type) ctype = String(ctype).slice(0, LIMITS.content_type);
  const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buf.length) return { ok: false, error: 'File is empty or not valid base64' };
  const docTag = body && body.doc_tag ? String(body.doc_tag).slice(0, 150) : null;
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), UW_DOC_DIR, String(caseId));
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = Date.now() + '_' + name.replace(/[^\w.\-]+/g, '_');
  fs.writeFileSync(path.join(absDir, safe), buf);
  const rel = path.join(UW_DOC_DIR, String(caseId), safe).replace(/\\/g, '/');
  const ins = await db.query(
    `INSERT INTO underwriting_documents (underwriting_case_id, step_no, file_name, file_path, content_type, doc_tag, uploaded_by, created_by)
     OUTPUT INSERTED.underwriting_document_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p6)`,
    [caseId, stepNo != null ? Number(stepNo) : null, name, rel, ctype, docTag, actorId(req)]);
  await writeAudit(caseId, { stepNo: stepNo != null ? Number(stepNo) : null, action: 'PHOTO_UPLOADED', req });
  return { ok: true, id: ins[0] ? ins[0].id : null };
}

async function listPhotos(caseId, stepNo) {
  let sql = `SELECT underwriting_document_id AS id, step_no, file_name, content_type, doc_tag, created_at
               FROM underwriting_documents WHERE underwriting_case_id = @p0 AND flag_deleted = 0`;
  const p = [caseId];
  if (stepNo != null) { sql += ' AND step_no = @p1'; p.push(Number(stepNo)); }
  sql += ' ORDER BY created_at DESC';
  return db.query(sql, p);
}

async function getPhoto(caseId, docId) {
  const rows = await db.query(
    `SELECT file_name, file_path, content_type FROM underwriting_documents
      WHERE underwriting_document_id = @p0 AND underwriting_case_id = @p1 AND flag_deleted = 0`, [docId, caseId]);
  if (!rows.length) return null;
  const abs = path.join(global.basePath || path.join(__dirname, '..'), rows[0].file_path);
  if (!fs.existsSync(abs)) return null;
  return { file_name: rows[0].file_name, content_type: rows[0].content_type, buffer: fs.readFileSync(abs) };
}

async function deletePhoto(caseId, docId, req) {
  await db.query(`UPDATE underwriting_documents SET flag_deleted = 1 WHERE underwriting_document_id = @p0 AND underwriting_case_id = @p1`, [docId, caseId]);
  await writeAudit(caseId, { action: 'PHOTO_DELETED', req });
  return { ok: true };
}

/**
 * Underwriting step 4 (Solicitor Quote) as a flat block for the application form
 * and the broker email. Returns {} when the step has not been filled in.
 */
async function solicitorFromStep4(caseId) {
  try {
    const rows = await db.query(
      `SELECT TOP 1 data FROM underwriting_steps WHERE underwriting_case_id = @p0 AND step_no = 4`, [caseId]);
    const f = ((safeJson(rows.length ? rows[0].data : null) || {}).fields) || {};
    // Client 15-10-2026: single rep -> section 5 is the BORROWER's solicitor captured in
    // this step (prefilled from the enquiry); legacy flat fields are the fallback.
    const bs = (String(f.rep_type || '').toLowerCase() !== 'dual' && f.borrower_solicitor && typeof f.borrower_solicitor === 'object') ? f.borrower_solicitor : {};
    const out = {
      firm_name: bs.firm_name || f.firm_name || null,
      contact_name: bs.contact_name || f.contact_name || null,
      sra_no: bs.sra_no || f.sra_no || null,
      lender_solicitor: f.lender_solicitor || null,
      quote_amount: f.quote_amount != null && f.quote_amount !== '' ? f.quote_amount : null,
      quote_date: f.quote_date || null,
      address: bs.address || f.address || null,
      telephone: bs.telephone || f.telephone || null,
      email: bs.email || f.email || null,
      sra_partners: f.sra_partners != null && f.sra_partners !== '' ? f.sra_partners : null,
    };
    // The Lender Solicitor select stores the master's NAME; pull its contact details.
    // Client 15-10-2026: also fills Number of SRA Partners from the Solicitor master.
    if (out.lender_solicitor && !bs.firm_name && (!out.telephone || !out.email || out.sra_partners == null)) {
      const m = await db.query(
        `SELECT TOP 1 * FROM solicitors
          WHERE flag_deleted = 0 AND (name = @p0 OR firm = @p0)`, [String(out.lender_solicitor)]);
      if (m.length) {
        if (out.sra_partners == null && m[0].sra_partners != null) out.sra_partners = m[0].sra_partners;
        out.telephone = out.telephone || m[0].phone || null;
        out.email = out.email || m[0].email || null;
        if (!out.firm_name) out.firm_name = m[0].firm || m[0].name || null;
      }
    }
    return out;
  } catch (e) {
    console.error('[underwriting] could not read step 4 solicitor details: ' + e.message);
    return {};
  }
}

/** Steps whose entries must have one accepted before "Proceed" (message when none is). */
const SELECT_STEPS = {
  2: 'Approve at least one valuation before proceeding to KYC.',
  3: 'Approve at least one KYC entry before proceeding to Solicitor Quote.',
  4: 'Approve at least one solicitor quote before proceeding to Requirements to Broker.',
};

/** Entries of an underwriting step: fields.entries, else the old single flat entry. */
async function stepEntries(caseId, stepNo, keys) {
  const rows = await db.query(
    `SELECT TOP 1 data FROM underwriting_steps WHERE underwriting_case_id = @p0 AND step_no = @p1`, [caseId, stepNo]);
  const f = ((safeJson(rows.length ? rows[0].data : null) || {}).fields) || {};
  if (Array.isArray(f.entries)) {
    const list = f.entries.filter((e) => e && typeof e === 'object');
    // Client 29-09-2026: once one or more entries are ACCEPTED only those go to the
    // broker; with none accepted (step not done yet) every entry is sent.
    const accepted = list.filter((e) => e.status === 'accepted');
    return accepted.length ? accepted : list;
  }
  const one = {};
  for (const k of keys) if (f[k] !== undefined && f[k] !== null && String(f[k]).trim() !== '') one[k] = f[k];
  return Object.keys(one).length ? [one] : [];
}

/**
 * Email body blocks for the Requirements Pack: one numbered table per entry under
 * "Valuation", "KYC / AML" and "Solicitor Quote". Empty sections are left out.
 */
async function requirementsEntriesHtml(caseId, esc) {
  const gbp = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null
    : '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const dmy = (v) => {
    const t = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('/') : (v || null);
  };
  const sections = [
    { no: 2, title: 'Valuation', keys: ['valuation_type', 'valuer_firm', 'instruction_date', 'report_due_date', 'fee', 'notes'],
      rows: (e) => [['Valuation Type', e.valuation_type], ['Valuer Firm', e.valuer_firm], ['Instruction Date', dmy(e.instruction_date)],
        ['Report Due Date', dmy(e.report_due_date)], ['Fee', gbp(e.fee)], ['Notes', e.notes]] },
    { no: 3, title: 'KYC / AML', keys: ['kyc_type', 'assign_to', 'due_date', 'notes'],
      rows: (e) => [['KYC Type', e.kyc_type], ['Assigned To', e.assign_to], ['Due Date', dmy(e.due_date)], ['Notes', e.notes]] },
    { no: 4, title: 'Solicitor Quote', keys: ['firm_name', 'contact_name', 'sra_no', 'lender_solicitor', 'quote_amount', 'quote_date'],
      rows: (e) => [['Firm Name', e.firm_name], ['Contact Name', e.contact_name], ['SRA / Regulator No.', e.sra_no],
        ['Lender Solicitor', e.lender_solicitor], ['Quote Amount', gbp(e.quote_amount)], ['Quote Date', dmy(e.quote_date)]] },
  ];
  const TD_K = 'padding:4px 14px 4px 0;color:#5a7394;vertical-align:top;white-space:nowrap';
  const TD_V = 'padding:4px 0;color:#0f2244';
  let html = '';
  for (const sec of sections) {
    let list = [];
    try { list = await stepEntries(caseId, sec.no, sec.keys); } catch (e) {
      console.error(`[underwriting] could not read step ${sec.no} entries: ${e.message}`);
    }
    const blocks = list.map((e, i) => {
      const lines = sec.rows(e).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
      if (!lines.length) return '';
      return `<p style="margin:10px 0 4px;font-weight:bold;color:#0f2244">${esc(sec.title)} ${list.length > 1 ? i + 1 : ''}</p>`
        + '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">'
        + lines.map(([k, v]) => `<tr><td style="${TD_K}">${esc(k)}</td><td style="${TD_V}">${esc(v)}</td></tr>`).join('')
        + '</table>';
    }).filter(Boolean);
    if (blocks.length) {
      html += `<h3 style="margin:18px 0 6px;font-family:Arial,sans-serif;font-size:15px;color:#0f2244;border-bottom:1px solid #d6dde8;padding-bottom:4px">`
        + `${esc(sec.title)}${blocks.length > 1 ? ' (' + blocks.length + ')' : ''}</h3>` + blocks.join('');
    }
  }
  return html;
}

/**
 * Requirements to Broker (step 5): email the broker/introducer taken from the
 * application (falling back to the enquiry) with
 *   - the application form PDF, and
 *   - the offer letter, attached as "Sanction-Letter-<ref>.pdf" (the client's
 *     name for the same document),
 * and a body that repeats the solicitor details captured in step 4
 * (Solicitor Quote), which the underwriter has just entered.
 */
async function sendRequirementsToBroker(caseId, req) {
  const rows = await db.query(
    `SELECT uc.underwriting_case_id, uc.application_id, a.enquiry_id, a.broker_id,
            br.name AS broker_name, br.email AS broker_email, a.application_ref
       FROM underwriting_cases uc
       LEFT JOIN applications a ON a.application_id = uc.application_id
       LEFT JOIN brokers br ON br.broker_id = a.broker_id
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0`, [caseId]);
  if (!rows.length) return { ok: false, notFound: true };
  const c = rows[0];

  // Client 08-10-2026: the "Requirements to Broker" step is gone — the underwriter
  // sends the requirements from the top of the case. A broker is NOT always
  // involved: use the broker when the application (or its enquiry) has one with an
  // e-mail, otherwise fall back to the applicant(s). For a COMPANY applicant that
  // means EVERY director / applicant on the file gets their OWN separate e-mail.
  let brokerName = c.broker_name; let brokerEmail = c.broker_email;
  if ((!brokerEmail || !c.broker_id) && c.enquiry_id) {
    const eb = await db.query(
      `SELECT br.name, br.email FROM enquiries e LEFT JOIN brokers br ON br.broker_id = e.broker_id
        WHERE e.enquiry_id = @p0`, [c.enquiry_id]);
    if (eb.length && eb[0].email) { brokerName = brokerName || eb[0].name; brokerEmail = eb[0].email; }
  }

  const esc = (t) => String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Recipients: the broker first; otherwise every applicant / director with an e-mail.
  const toBroker = !!(brokerEmail && String(brokerEmail).includes('@'));
  let recipients = [];
  if (toBroker) {
    recipients = [{ name: brokerName || 'Broker', email: String(brokerEmail).trim() }];
  } else {
    const aps = await db.query(
      `SELECT ap.first_name, ap.last_name, ap.company_name, ap.email
         FROM application_applicants aa
         JOIN applicants ap ON ap.applicant_id = aa.applicant_id
        WHERE aa.application_id = @p0 AND ap.email IS NOT NULL AND LTRIM(RTRIM(ap.email)) <> ''`,
      [c.application_id]);
    const seen = new Set();
    for (const a of aps) {
      const em = String(a.email || '').trim();
      if (!em.includes('@') || seen.has(em.toLowerCase())) continue;
      seen.add(em.toLowerCase());
      const nm = [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || a.company_name || 'Applicant';
      recipients.push({ name: nm, email: em });
    }
  }
  if (!recipients.length) {
    return {
      ok: false,
      error: 'No one to send the requirements to. Add a broker with an e-mail on the application / enquiry, '
        + 'or an e-mail address on the applicant(s).',
    };
  }

  // Build the application-form PDF from the linked enquiry (best source of the full form).
  let enquiry = {};
  if (c.enquiry_id) { try { enquiry = (await enquirySvc.getById(c.enquiry_id)) || {}; } catch (_) { enquiry = {}; } }
  // Section 5 "Solicitor Details" of the application form is filled from underwriting
  // step 4 (Solicitor Quote).
  const solicitor = await solicitorFromStep4(caseId);
  // Loan figures on the form come from the offer actually issued (client 14-10-2026).
  let offerForForm = null;
  if (c.enquiry_id) {
    try {
      const o = await db.query(
        `SELECT TOP 1 offer_json FROM enquiry_offers
           WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status IN ('Accepted', 'Sent')
           ORDER BY CASE WHEN status = 'Accepted' THEN 0 ELSE 1 END, version_no DESC`, [c.enquiry_id]);
      if (o.length && o[0].offer_json) offerForForm = safeJson(o[0].offer_json) || null;
    } catch (_) { offerForForm = null; }
  }
  const buffer = await pdf.buildApplicationFormPdf(enquiry, {}, { solicitor, offer: offerForForm });
  const ref = c.application_ref || ('APP-' + c.application_id);
  const attachments = [{ filename: `Application-Form-${ref}.pdf`, buffer, contentType: 'application/pdf' }];

  // Offer letter — attached under the client's name for it, "Sanction Letter".
  try {
    if (c.enquiry_id) {
      const off = await db.query(
        `SELECT TOP 1 offer_json FROM enquiry_offers
           WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status IN ('Accepted', 'Sent')
           ORDER BY CASE WHEN status = 'Accepted' THEN 0 ELSE 1 END, version_no DESC`, [c.enquiry_id]);
      if (off.length && off[0].offer_json) {
        const offerJson = safeJson(off[0].offer_json) || {};
        const letter = await pdf.buildOfferPdf(offerJson, enquiry);
        attachments.push({ filename: `Sanction-Letter-${ref}.pdf`, buffer: letter, contentType: 'application/pdf' });
      }
    }
  } catch (e) {
    // The requirements pack still goes out if the letter cannot be rendered.
    console.error('[underwriting] could not attach the sanction letter for ' + ref + ': ' + e.message);
  }

  // Valuation (step 2), KYC / AML (step 3) and Solicitor Quote (step 4) entries in the body.
  const detailsHtml = await requirementsEntriesHtml(caseId, esc);

  // One SEPARATE e-mail per recipient (a company's directors each get their own copy).
  const results = [];
  for (const [i, rcp] of recipients.entries()) {
    // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
    const mailVars = {
      Ref: ref, Borrower: enquiry.company_name || enquiry.applicant_name || '',
      RecipientName: rcp.name || (toBroker ? 'Broker' : 'Applicant'), RequirementsDetails: detailsHtml,
    };
    const { subject, html } = emailHub.render('UW_REQUIREMENTS_PACK', mailVars);
    // eslint-disable-next-line no-await-in-loop
    const res = await mail.sendMail({
      // Email Settings master + Email History (client 17-10-2026). Extra CC on the first copy only.
      event: 'UW_REQUIREMENTS_PACK', ref: { module: 'UNDERWRITING', id: caseId, number: ref }, req, applyRules: i === 0,
      vars: mailVars, subject, html,
      to: rcp.email,
      attachments,
    });
    const ok = !!(res && res.ok !== false);
    results.push({ email: rcp.email, ok, error: res && res.error });
    if (!ok) console.error(`[underwriting] requirements e-mail to ${rcp.email} failed for case ${caseId}: ${res && res.error}`);
  }
  const okList = results.filter((r) => r.ok);
  await writeAudit(caseId, {
    action: okList.length ? 'REQUIREMENTS_SENT' : 'REQUIREMENTS_SEND_FAILED',
    to: okList.map((r) => r.email).join(', ') || undefined, req,
  });
  if (!okList.length) {
    return { ok: false, error: results.map((r) => `${r.email}: ${r.error || 'failed'}`).join('; ') || 'Email failed to send' };
  }
  return { ok: true, to: okList.map((r) => r.email).join(', '), recipients: okList.length, broker: toBroker };
}

/**
 * The signed offer letter + application form uploaded at convert (28-09-2026), read
 * through the underwriting case so an underwriter needs only Underwriting > view.
 */
async function getSignedOffer(caseId, docId) {
  const rows = await db.query(
    `SELECT d.file_name, d.file_path
       FROM underwriting_cases uc
       JOIN applications a ON a.application_id = uc.application_id
       JOIN application_documents d ON d.application_id = a.application_id AND d.flag_deleted = 0
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0
        AND (d.app_document_id = a.signed_offer_doc_id OR dt.code IN ('SIGNED_OFFER', 'DEAL_SUMMARY')
             OR d.file_name LIKE 'Credit Deal Summary%')
        AND (@p1 IS NULL OR d.app_document_id = @p1)
      ORDER BY CASE WHEN dt.code = 'DEAL_SUMMARY' OR d.file_name LIKE 'Credit Deal Summary%' THEN 0
                    WHEN d.app_document_id = a.signed_offer_doc_id THEN 1 ELSE 2 END, d.app_document_id`,
    [caseId, docId ? Number(docId) : null]);
  return rows[0] || null;
}

/** Every signed offer / application form file uploaded at convert, for the review viewer. */
async function listSignedOffers(applicationId, firstId) {
  if (!applicationId) return [];
  // Client 07-10-2026: the Credit Deal Summary (the PDF e-mailed to Head of
  // Application at convert) is shown in this same header card, ahead of the
  // signed offer / application form — mirroring the Application Detail page.
  return db.query(
    `SELECT d.app_document_id AS id, d.file_name,
            CASE WHEN dt.code = 'DEAL_SUMMARY' OR d.file_name LIKE 'Credit Deal Summary%' THEN 0 ELSE 1 END AS sort_order
       FROM application_documents d
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE d.application_id = @p0 AND d.flag_deleted = 0
        AND (dt.code IN ('SIGNED_OFFER', 'DEAL_SUMMARY')
             OR d.file_name LIKE 'Credit Deal Summary%'
             OR d.app_document_id = @p1)
      ORDER BY sort_order, d.app_document_id`, [applicationId, firstId || null]);
}

/**
 * Merged underwriting step (UI "Step 5"): combines config steps 6 (Underwrite &
 * Findings), 7 (Credit Discussion - via popup), 8 (Credit Paper) and 9 (Site
 * Visit & Diligence) into one screen. The four backend steps are kept intact
 * (no data migration); this completes them together and advances to step 10.
 */
async function completeMergedStep(caseId, body, req) {
  const def6 = CFG.stepByNo(6);
  if (!(await canActStep(def6, req))) return { ok: false, forbidden: true };
  await ensureSteps(caseId, req);
  const cas = await db.query('SELECT current_step, status FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!cas.length) return { notFound: true };
  const data = (body && body.data) || {};
  const findings = String(data.findings == null ? '' : data.findings).trim();
  const site = data.site_visit || {};
  // Client 09-10-2026: Underwriting Review now requires ONLY the Findings &
  // Recommendation. The credit paper upload and site-visit details are optional here
  // (the latest uploaded credit paper still flows to the committee step when present).
  if (!findings) return { ok: false, error: 'Enter Risk Finding / Recommendation before proceeding.' };

  // Save + complete step 6 (findings) and step 9 (site visit); mark 7 + 8 complete.
  await db.query(`UPDATE underwriting_steps SET status=@p2, data=@p3, decision='proceed', completed_at=SYSUTCDATETIME(), updated_by=@p4, updated_at=SYSUTCDATETIME() WHERE underwriting_case_id=@p0 AND step_no=@p1`,
    [caseId, 6, ST.COMPLETED, JSON.stringify({ fields: { risk_finding: findings } }), actorId(req)]);
  await db.query(`UPDATE underwriting_steps SET status=@p2, data=@p3, completed_at=SYSUTCDATETIME(), updated_by=@p4, updated_at=SYSUTCDATETIME() WHERE underwriting_case_id=@p0 AND step_no=@p1`,
    [caseId, 9, ST.COMPLETED, JSON.stringify({ fields: { visit_type: site.visit_type || '', visit_date: site.visit_date || '', diligence_notes: site.diligence_notes || '', docs_signed_date: site.docs_signed_date || '' } }), actorId(req)]);
  for (const n of [7, 8]) {
    await db.query(`UPDATE underwriting_steps SET status=@p2, completed_at=SYSUTCDATETIME(), updated_by=@p3, updated_at=SYSUTCDATETIME() WHERE underwriting_case_id=@p0 AND step_no=@p1 AND status NOT IN (@p2)`,
      [caseId, n, ST.COMPLETED, actorId(req)]);
  }
  // Application -> Credit Review (underwriting recommends proceed to the committee).
  const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
  const appId = cr[0] && cr[0].application_id;
  if (appId) {
    await db.query('UPDATE applications SET uw_recommendation = @p1 WHERE application_id = @p0', [appId, 'Proceed']).catch(() => {});
    await setAppStatusForward(appId, 'UNDERWRITING', req); // Credit Review stage retired (client 15-10-2026): stays in Underwriting until the committee approves
  }
  // Advance to step 10 (Final Credit Committee).
  await db.query(`UPDATE underwriting_steps SET status=@p2, started_at=SYSUTCDATETIME() WHERE underwriting_case_id=@p0 AND step_no=@p1 AND status=@p3`, [caseId, 10, ST.IN_PROGRESS, ST.LOCKED]);
  await db.query(`UPDATE underwriting_cases SET current_step = CASE WHEN 10 > current_step THEN 10 ELSE current_step END, status=@p1, updated_by=@p2, updated_at=SYSUTCDATETIME() WHERE underwriting_case_id=@p0`, [caseId, S.IN_PROGRESS, actorId(req)]);
  await writeAudit(caseId, { stepNo: 6, action: 'MERGED_UW_COMPLETED', to: ST.COMPLETED, req });
  return { ok: true, next: 10 };
}

/** "Refer to Credit" popup: save the Credit Discussion (step 7) + send the
 *  application to Credit Review, WITHOUT advancing (stays on the merged step). */
async function referToCredit(caseId, body, req) {
  const def6 = CFG.stepByNo(6);
  if (!(await canActStep(def6, req))) return { ok: false, forbidden: true };
  await ensureSteps(caseId, req);
  const f = (body && body.data && body.data.fields) || {};
  await db.query(`UPDATE underwriting_steps SET data=@p2, updated_by=@p3, updated_at=SYSUTCDATETIME() WHERE underwriting_case_id=@p0 AND step_no=@p1`,
    [caseId, 7, JSON.stringify({ fields: f }), actorId(req)]);
  const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [caseId]);
  const appId = cr[0] && cr[0].application_id;
  if (appId) {
    await db.query('UPDATE applications SET uw_recommendation = @p1 WHERE application_id = @p0', [appId, 'Refer to Credit']).catch(() => {});
    await setAppStatusForward(appId, 'UNDERWRITING', req); // Credit Review stage retired (client 15-10-2026): stays in Underwriting until the committee approves
  }
  await writeAudit(caseId, { stepNo: 7, action: 'REFERRED_TO_CREDIT', req });
  return { ok: true };
}

async function reopenCase(id, req) {
  const rows = await db.query('SELECT status, current_step FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [id]);
  if (!rows.length) return { notFound: true };
  const st = String(rows[0].status || '');
  if (!['Closed', 'Rejected'].includes(st)) return { ok: false, error: 'Only a closed or rejected case can be reopened.' };
  const step = rows[0].current_step && rows[0].current_step > 1 ? rows[0].current_step : 2;
  await db.query('UPDATE underwriting_cases SET status = @p1, current_step = @p2, updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0',
    [id, S.IN_PROGRESS, step, actorId(req)]);
  // re-open the application side too so the case can move forward again.
  try {
    const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0', [id]);
    if (cr[0] && cr[0].application_id) await setAppStatus(cr[0].application_id, 'UNDERWRITING', req);
  } catch (e) { /* best-effort */ }
  await writeAudit(id, { action: 'CASE_REOPENED', from: st, to: S.IN_PROGRESS, req });
  return { ok: true };
}

/** Label shown for an underwriting step's uploads in the committee document picker. */
const UW_DOC_STEP_LABEL = { 1: 'Initial review', 2: 'Valuation report', 3: 'KYC / AML', 4: 'Solicitor check', 6: 'Underwriting review', 7: 'Underwriting review', 8: 'Credit paper', 9: 'Site visit', 10: 'Credit committee', 11: 'Funds / completion', 12: 'Completion' };

/**
 * Client 16-10-2026: every document on the case that can go to the Final Credit Committee
 * with the credit paper - the application's documents (valuation / title reports, signed
 * offer, deal summary, ...) and the underwriting uploads (valuation reports, KYC, ...).
 */
async function listCaseDocuments(caseId) {
  const cr = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!cr.length) return { notFound: true };
  const appId = cr[0].application_id;
  const app = appId ? await db.query(
    `SELECT d.app_document_id AS id, d.file_name, d.version, d.created_at,
            COALESCE(dt.name, 'Document') AS type_name, dt.category
       FROM application_documents d
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE d.application_id = @p0 AND d.flag_deleted = 0
      ORDER BY d.app_document_id DESC`, [appId]) : [];
  const uwd = await db.query(
    `SELECT underwriting_document_id AS id, step_no, file_name, created_at
       FROM underwriting_documents WHERE underwriting_case_id = @p0 AND flag_deleted = 0
      ORDER BY underwriting_document_id DESC`, [caseId]);
  // Client 22-10-2026: the enquiry's own documents can go to the committee too.
  const enq = appId ? await db.query(
    `SELECT d.enquiry_document_id AS id, d.file_name, d.created_at, COALESCE(dt.name, 'Enquiry document') AS type_name
       FROM enquiry_documents d
       JOIN applications a ON a.enquiry_id = d.enquiry_id AND a.application_id = @p0
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE d.flag_deleted = 0 AND d.file_path IS NOT NULL
      ORDER BY d.enquiry_document_id DESC`, [appId]).catch(() => []) : [];
  return {
    ok: true,
    rows: [
      ...app.map((d) => ({ source: 'application', id: d.id, file_name: d.file_name, label: [d.type_name, d.version].filter(Boolean).join(' · '), created_at: d.created_at })),
      ...uwd.map((d) => ({ source: 'underwriting', id: d.id, file_name: d.file_name, label: UW_DOC_STEP_LABEL[d.step_no] || 'Underwriting', step_no: d.step_no, created_at: d.created_at })),
      ...enq.map((d) => ({ source: 'enquiry', id: d.id, file_name: d.file_name, label: `Enquiry · ${d.type_name}`, created_at: d.created_at })),
    ],
  };
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain',
};
const mimeOf = (name, ct) => ct || MIME_BY_EXT[String(name || '').split('.').pop().toLowerCase()] || 'application/octet-stream';

/**
 * Step 5 Final Credit Committee (client 07-10-2026): e-mail the final / latest
 * Credit Deal Summary to the Head of Application users (the "bosses"), the same
 * recipients the interim summary went to at convert.
 * Client 16-10-2026 (opts):
 *   documents: [{ source: 'application'|'underwriting', id }]  - case documents to attach too
 *   uploads:   [{ file_name, content_base64, content_type }]   - extra files picked in the popup;
 *              saved to the application's Documents first, then attached
 *   notes:     free text added to the e-mail body
 * Every Solicitor Check must be complete before the paper can go to the committee.
 */
async function sendFinalCreditPaper(caseId, emails, req, opts = {}) {
  const rows = await db.query(
    `SELECT uc.application_id, a.application_ref,
            COALESCE(ap.company_name, NULLIF(LTRIM(RTRIM(CONCAT(ap.first_name, ' ', ap.last_name))), ''), 'Borrower') AS borrower
       FROM underwriting_cases uc
       JOIN applications a ON a.application_id = uc.application_id
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0`, [caseId]);
  if (!rows.length) return { notFound: true };
  const sc = await caseSolicitorChecks(caseId);
  if (!sc.ok) return { ok: false, error: 'Complete all Solicitor Checks (Step 2 Solicitor Quote) before sending to the Credit Committee: ' + sc.missing.join(', ') };
  const notes = String((opts && opts.notes) || '').trim();
  const badNotes = overLimit('Notes', notes, LIMITS.free_text);
  if (badNotes) return { ok: false, error: badNotes, errors: { notes: badNotes } };
  const appId = rows[0].application_id;
  const appRef = rows[0].application_ref || ('APP-' + appId);
  const borrower = rows[0].borrower || 'Borrower';
  const base = global.basePath || path.join(__dirname, '..');
  // Client 09-10-2026: send the LATEST credit paper uploaded in the Underwriting Review
  // step (underwriting_documents, step 8). Fall back to the Credit Deal Summary document
  // on the application when no credit paper has been uploaded yet.
  let docRows = await db.query(
    `SELECT TOP 1 underwriting_document_id AS id, file_name, file_path, content_type FROM underwriting_documents
      WHERE underwriting_case_id = @p0 AND step_no = 8 AND flag_deleted = 0
      ORDER BY underwriting_document_id DESC`, [caseId]);
  let paperSource = 'underwriting';
  if (!docRows.length) {
    paperSource = 'application';
    docRows = await db.query(
      `SELECT TOP 1 d.app_document_id AS id, d.file_name, d.file_path, NULL AS content_type FROM application_documents d
         LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
        WHERE d.application_id = @p0 AND d.flag_deleted = 0
          AND (dt.code = 'DEAL_SUMMARY' OR d.file_name LIKE 'Credit Deal Summary%')
        ORDER BY d.app_document_id DESC`, [appId]);
  }
  if (!docRows.length) return { ok: false, error: 'No credit paper on file to send. Upload the credit paper in the Underwriting Review step first.' };
  const abs = path.join(base, docRows[0].file_path);
  if (!fs.existsSync(abs)) return { ok: false, error: 'The credit paper file is missing on the server.' };
  const attachments = [{ filename: docRows[0].file_name, buffer: fs.readFileSync(abs), contentType: mimeOf(docRows[0].file_name, docRows[0].content_type) }];
  const seen = new Set([`${paperSource}:${docRows[0].id}`]);

  // Picked case documents (only ones that belong to THIS case / application).
  const picked0 = Array.isArray(opts && opts.documents) ? opts.documents : [];
  for (const d of picked0.slice(0, 50)) {
    const src0 = String((d && d.source) || '');
    const src = src0 === 'underwriting' || src0 === 'enquiry' ? src0 : 'application';
    const did = Number(d && d.id);
    if (!Number.isFinite(did) || did <= 0 || seen.has(`${src}:${did}`)) continue;
    seen.add(`${src}:${did}`);
    // eslint-disable-next-line no-await-in-loop
    const r = src === 'underwriting'
      ? await db.query(`SELECT file_name, file_path, content_type FROM underwriting_documents
                         WHERE underwriting_document_id = @p0 AND underwriting_case_id = @p1 AND flag_deleted = 0`, [did, caseId])
      : src === 'enquiry'
      ? await db.query(`SELECT d.file_name, d.file_path, NULL AS content_type FROM enquiry_documents d
                          JOIN applications a ON a.enquiry_id = d.enquiry_id AND a.application_id = @p1
                         WHERE d.enquiry_document_id = @p0 AND d.flag_deleted = 0`, [did, appId])
      : await db.query(`SELECT file_name, file_path, NULL AS content_type FROM application_documents
                         WHERE app_document_id = @p0 AND application_id = @p1 AND flag_deleted = 0`, [did, appId]);
    if (!r.length) return { ok: false, error: 'A selected document no longer exists - refresh and pick again.' };
    const p = path.join(base, r[0].file_path);
    if (!fs.existsSync(p)) return { ok: false, error: `The file "${r[0].file_name}" is missing on the server.` };
    attachments.push({ filename: r[0].file_name, buffer: fs.readFileSync(p), contentType: mimeOf(r[0].file_name, r[0].content_type) });
  }

  // Extra files uploaded in the popup: validate all first, then store as application documents.
  const ups = Array.isArray(opts && opts.uploads) ? opts.uploads.slice(0, 20) : [];
  const parsed = [];
  for (const u of ups) {
    const name = String((u && u.file_name) || '').trim();
    const b64 = String((u && u.content_base64) || '');
    if (!name || !b64) return { ok: false, error: 'Each uploaded file needs a name and content.' };
    const badName = overLimit('File name', name, LIMITS.file_name);
    if (badName) return { ok: false, error: badName };
    const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) return { ok: false, error: `"${name}" is empty or not valid.` };
    const ct = (b64.match(/^data:([^;]+);base64,/) || [])[1] || (u && u.content_type) || null;
    parsed.push({ name, buf, ct });
  }
  const DOC_DIR = path.join('uploads', 'application_documents');
  const absDir = path.join(base, DOC_DIR);
  if (parsed.length && !fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  for (const u of parsed) {
    const safe = Date.now() + '_' + u.name.replace(/[^\w.\-]+/g, '_');
    fs.writeFileSync(path.join(absDir, safe), u.buf);
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
       VALUES (@p0, NULL, @p1, @p2, 'Uploaded', 'v1', @p3, @p3)`,
      [appId, u.name, path.join(DOC_DIR, safe).replace(/\\/g, '/'), actorId(req)]);
    attachments.push({ filename: u.name, buffer: u.buf, contentType: mimeOf(u.name, u.ct) });
  }
  if (parsed.length) await writeAudit(caseId, { stepNo: 10, action: 'COMMITTEE_DOCS_UPLOADED', req, reason: parsed.map((u) => u.name).join(', ') });

  // Recipients: the emails the user ticked / typed in the Send popup (client 09-10-2026);
  // falls back to every Head of Underwriting when none are supplied.
  const allHeads = await dealSummary.headOfUnderwritingUsers();
  const picked = Array.isArray(emails) ? emails.map((e) => String(e || '').trim()).filter(Boolean) : [];
  let heads;
  if (picked.length) {
    const byEmail = new Map(allHeads.map((h) => [String(h.email || '').toLowerCase(), h]));
    const seenE = new Set();
    heads = picked.filter((e) => { const k = e.toLowerCase(); if (seenE.has(k)) return false; seenE.add(k); return true; })
      .map((e) => byEmail.get(e.toLowerCase()) || { email: e, full_name: '' });
  } else {
    heads = allHeads;
  }
  if (!heads.length) return { ok: false, error: 'Select at least one recipient to send to.' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const link = String((envConfig && envConfig.frontUrl) || '').replace(/\/?$/, '/') + 'underwriting/' + caseId;
  const extraList = attachments.length > 1
    ? `<p>Also attached:</p><ul>${attachments.slice(1).map((a) => `<li>${esc(a.filename)}</li>`).join('')}</ul>` : '';
  const notesHtml = notes ? `<p><b>Notes:</b><br/>${esc(notes).replace(/\r?\n/g, '<br/>')}</p>` : '';
  const results = [];
  for (const [i, h] of heads.entries()) {
    // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
    const mailVars = {
      Ref: appRef, Borrower: borrower, RecipientName: h.full_name || '', RecipientFirstName: String(h.full_name || '').split(' ')[0] || 'there',
      Notes: notes, Link: link, NotesBlock: notesHtml, AlsoAttachedList: extraList,
    };
    const { subject, html } = emailHub.render('UW_FINAL_CREDIT_PAPER', mailVars);
    // eslint-disable-next-line no-await-in-loop
    const r = await mail.sendMail({
      to: h.email, subject, html, attachments,
      // Email Settings master + Email History (client 17-10-2026). Extra CC on the first copy only.
      event: 'UW_FINAL_CREDIT_PAPER', ref: { module: 'UNDERWRITING', id: caseId, number: appRef }, req, applyRules: i === 0,
      vars: mailVars,
    });
    results.push({ email: h.email, ok: !!r.ok, error: r.ok ? undefined : r.error });
    if (!r.ok) console.error(`[final-credit-paper] e-mail to ${h.email} failed for case ${caseId}: ${r.error}`);
  }
  const okList = results.filter((r) => r.ok);
  await writeAudit(caseId, {
    stepNo: 10, action: okList.length ? 'FINAL_CREDIT_PAPER_SENT' : 'FINAL_CREDIT_PAPER_FAILED', req,
    reason: `${attachments.length} attachment(s)${notes ? ' + notes' : ''}`,
  });
  if (!okList.length) return { ok: false, error: results.map((r) => `${r.email}: ${r.error}`).join('; ') || 'Send failed' };
  return { ok: true, sentTo: okList.length, to: okList.map((r) => r.email).join(', '), attachments: attachments.length };
}

/**
 * Step 5 Underwriting Review (client 07-10-2026): upload an UPDATED Credit Deal
 * Summary. Saved as a DEAL_SUMMARY application document, so it also appears in the
 * case's documents header (listSignedOffers already surfaces DEAL_SUMMARY).
 */
async function uploadCreditSummary(caseId, body, req) {
  const caseRow = await db.query('SELECT application_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!caseRow.length) return { notFound: true };
  const appId = caseRow[0].application_id;
  const nameIn = String((body && body.file_name) || '').trim();
  const b64 = String((body && body.content_base64) || '');
  if (!nameIn || !b64) return { ok: false, error: 'file_name and content_base64 are required' };
  const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buf.length) return { ok: false, error: 'File is empty or not valid base64' };
  const DOC_DIR = path.join('uploads', 'application_documents');
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const ext = (nameIn.match(/\.[A-Za-z0-9]+$/) || ['.pdf'])[0];
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `Credit Deal Summary (Updated ${stamp})${ext}`;
  const safe = Date.now() + '_' + fileName.replace(/[^\w.\-]+/g, '_');
  fs.writeFileSync(path.join(absDir, safe), buf);
  const t = await db.query("SELECT TOP 1 document_type_id AS id FROM document_types WHERE code = 'DEAL_SUMMARY'");
  const uid = actorId(req);
  await db.query(
    `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
     VALUES (@p0, @p1, @p2, @p3, 'Uploaded', 'v1', @p4, @p4)`,
    [appId, t.length ? t[0].id : null, fileName, path.join(DOC_DIR, safe).replace(/\\/g, '/'), uid]);
  await writeAudit(caseId, { stepNo: 6, action: 'CREDIT_SUMMARY_UPDATED', req });
  return { ok: true };
}

/**
 * Deal-level underwriter notes (client 07-10-2026): a free-text scratchpad shown
 * on the side of the stepper, OUTSIDE the step process. One note per case — the
 * underwriter jots reminders here instead of on paper.
 */
async function saveNotes(caseId, body, req) {
  const notes = body && body.notes != null ? String(body.notes) : '';
  const bad = overLimit('Notes', notes, 200000); // JSON array of multiple notes
  if (bad) return { ok: false, error: bad, errors: { notes: bad } };
  const r = await db.query(
    'SELECT underwriting_case_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!r.length) return { notFound: true };
  await db.query(
    `UPDATE underwriting_cases SET underwriter_notes = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE underwriting_case_id = @p0`, [caseId, notes || null, actorId(req)]);
  await writeAudit(caseId, { action: 'NOTES_SAVED', req });
  return { ok: true };
}

/**
 * Client 12-10-2026: let the underwriter change the Gross Loan and Net Advance on the
 * case. Writes to the application and recomputes the loan LTV (gross ÷ net security
 * value) the same way convert does, so the header, deal summary and credit paper follow.
 */
/**
 * Client 12-10-2026: the underwriter edited the indicative in Underwriting ("Edit loan").
 * Client 16-10-2026 (revised): the new terms are saved as a new indicative version (internal -
 * no indicative e-mail any more), pushed onto the application / live loan, and a REVISED OFFER
 * LETTER is generated and e-mailed straight away to the broker asking for the new terms to be
 * signed (CC the BDM). Underwriting is NOT reset - the other
 * steps carry on while the case waits for the signed offer, which is uploaded from the case
 * header (uploadRevisedSignedOffer) and lands in the application documents as the next version.
 * body = { inputs }
 */
async function saveIndicativeEdit(caseId, body, req) {
  const enquiryService = require('./enquiry.service');
  const offer = require('./enquiry.offer.service');
  let liveLoan = null; try { liveLoan = require('./liveLoan.service'); } catch (_) { liveLoan = null; }
  const c = await getCase(caseId);
  if (!c) return { notFound: true };
  if (!c.enquiry_id) return { ok: false, error: 'This application has no source enquiry to edit the loan terms for.' };
  if (!c.application_id) return { ok: false, error: 'No application linked to this underwriting case.' };
  // 1) Save a new indicative version on the enquiry (status Draft; created_by = this user).
  const saved = await offer.saveIndicative(c.enquiry_id, body || {}, req);
  if (!saved || saved.notFound) return { ok: false, error: 'Source enquiry not found.' };
  const vid = saved.id;
  const calcObj = saved.data && saved.data.calc ? saved.data.calc : {};
  const inputsObj = saved.data && saved.data.inputs ? saved.data.inputs : {};
  // Keep a PDF of this version so the enquiry's offer history can download it (not e-mailed).
  try { await offer.indicativePdf(c.enquiry_id, vid, req); } catch (e) { /* best-effort */ }
  // 2) Push the new figures onto the application (fees, agreed_terms, gross/net/LTV/term/rate).
  const enquiry = await enquiryService.getById(c.enquiry_id);
  let figures = null;
  try { figures = await enquiryService.applyIndicativeToApplication(c.application_id, enquiry, calcObj, inputsObj, actorId(req)); }
  catch (e) { return { ok: false, error: 'New terms saved but could not update the application: ' + e.message }; }
  // 3) Rebuild the live loan if the deal is already in the portfolio (skipped when payments exist).
  if (liveLoan && liveLoan.ensure) { try { await liveLoan.ensure(c.application_id, req); } catch (e) { /* loan may not exist yet */ } }

  // 4) New offer version built from the new indicative; the letter-only choices made at
  //    Send Offer (broker-fee split, legal fees wording, ...) carry over from the live offer.
  const prevRows = await db.query(
    `SELECT TOP 1 offer_json FROM enquiry_offers WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status IN ('Accepted', 'Sent')
      ORDER BY version_no DESC`, [c.enquiry_id]);
  const prev = prevRows.length ? (safeJson(prevRows[0].offer_json) || {}) : {};
  const carry = {};
  for (const k of ['broker_fee_is_pct', 'broker_fee_value', 'legal_fees_text', 'not_principal_residence', 'validity_days',
    'min_term_months', 'default_rate_pct', 'borrower_name', 'borrower_address']) {
    if (prev[k] !== undefined && prev[k] !== null && prev[k] !== '') carry[k] = prev[k];
  }
  const termIn = Number(inputsObj.term_months || calcObj.term_months);
  if (Number.isFinite(termIn) && termIn > 0) carry.term_months = termIn;
  if (figures && figures.ltvPct != null) carry.ltv_pct = figures.ltvPct;
  carry.indicative_id = vid;
  const ov = await offer.saveOfferVersion(c.enquiry_id, { indicative_id: vid, offer: carry }, req);
  if (!ov || !ov.ok) return { ok: false, error: (ov && ov.error) || 'New terms saved but the revised offer could not be created.' };

  // 5) E-mail the revised offer letter to the broker, CC the BDM only (client 16-10-2026).
  const ccIn = [c.bdm_email];
  let sent = null;
  try { sent = await offer.sendRevisedOffer(c.enquiry_id, ov.id, req, { cc: ccIn.filter(Boolean) }); }
  catch (e) { sent = { ok: false, emailed: false, error: e.message }; }

  // 6) The case now waits for the signed revised offer - nothing is reset (client 16-10-2026).
  await db.query(
    `UPDATE underwriting_cases SET revised_offer_pending = 1, revised_offer_id = @p1, revised_offer_sent_at = SYSUTCDATETIME(),
            updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE underwriting_case_id = @p0`, [caseId, ov.id, actorId(req)]);
  const emailed = !!(sent && sent.emailed);
  await writeAudit(caseId, { action: 'LOAN_TERMS_REVISED', req,
    reason: `Indicative v${saved.version} / revised offer v${ov.version} — gross ${figures ? figures.grossAmount : ''}, LTV ${figures ? figures.ltvPct : ''}%`
      + (emailed ? ` — offer e-mailed to ${sent.to}${sent.cc && sent.cc.length ? ' (cc ' + sent.cc.join(', ') + ')' : ''}` : ` — offer NOT e-mailed${sent && sent.error ? ': ' + sent.error : ''}`)
      + ' — awaiting signed offer' });
  return { ok: true, id: vid, version: saved.version, offer_id: ov.id, offer_version: ov.version,
    emailed, email_error: emailed ? null : (sent && sent.error) || null, email_to: sent && sent.to, figures };
}

/**
 * Client 16-10-2026: upload the SIGNED revised offer letter from the case header. Stored as a
 * Signed Offer application document with the next version number (v2, v3, ...), the revised
 * offer becomes the Accepted one and the case stops waiting.
 * body = { files: [{ file_name, content_base64 }] } (or a single file_name / content_base64).
 */
async function uploadRevisedSignedOffer(caseId, body, req) {
  const r = await db.query(
    `SELECT uc.application_id, uc.revised_offer_id, uc.revised_offer_pending, a.enquiry_id
       FROM underwriting_cases uc JOIN applications a ON a.application_id = uc.application_id
      WHERE uc.underwriting_case_id = @p0 AND uc.flag_deleted = 0`, [caseId]);
  if (!r.length) return { notFound: true };
  const { application_id: appId, revised_offer_id: offerId, enquiry_id: enquiryId } = r[0];
  const files = Array.isArray(body && body.files) && body.files.length ? body.files
    : (body && body.file_name ? [{ file_name: body.file_name, content_base64: body.content_base64 }] : []);
  if (!files.length) return { ok: false, error: 'Choose the signed offer file to upload.' };
  const parsed = [];
  for (const f of files.slice(0, 10)) {
    const name = String((f && f.file_name) || '').trim();
    const b64 = String((f && f.content_base64) || '');
    if (!name || !b64) return { ok: false, error: 'file_name and content_base64 are required' };
    const bad = overLimit('File name', name, LIMITS.file_name);
    if (bad) return { ok: false, error: bad };
    const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) return { ok: false, error: `"${name}" is empty or not valid.` };
    parsed.push({ name, buf });
  }
  const t = await db.query("SELECT TOP 1 document_type_id AS id FROM document_types WHERE code = 'SIGNED_OFFER'");
  const typeId = t.length ? t[0].id : null;
  // Next version = highest existing signed-offer version + 1 (the convert upload is v1).
  const vr = await db.query(
    `SELECT MAX(TRY_CONVERT(INT, REPLACE(LOWER(d.version), 'v', ''))) AS v
       FROM application_documents d LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE d.application_id = @p0 AND d.flag_deleted = 0 AND dt.code = 'SIGNED_OFFER'`, [appId]);
  const version = 'v' + (((vr[0] && vr[0].v) || 1) + 1);
  const DOC_DIR = path.join('uploads', 'application_documents');
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const ids = [];
  for (const f of parsed) {
    const safe = Date.now() + '_' + f.name.replace(/[^\w.\-]+/g, '_');
    fs.writeFileSync(path.join(absDir, safe), f.buf);
    // eslint-disable-next-line no-await-in-loop
    const out = await db.query(
      `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
       OUTPUT INSERTED.app_document_id AS id
       VALUES (@p0, @p1, @p2, @p3, 'Uploaded', @p4, @p5, @p5)`,
      [appId, typeId, f.name, path.join(DOC_DIR, safe).replace(/\\/g, '/'), version, actorId(req)]);
    if (out[0]) ids.push(out[0].id);
  }
  // The revised offer is now the signed / accepted one.
  if (offerId && enquiryId) {
    await db.query(
      `UPDATE enquiry_offers SET status = 'Superseded', updated_at = SYSUTCDATETIME()
        WHERE enquiry_id = @p0 AND status = 'Accepted' AND enquiry_offer_id <> @p1 AND flag_deleted = 0`, [enquiryId, offerId]);
    await db.query(
      `UPDATE enquiry_offers SET status = 'Accepted', accepted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
        WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1`, [offerId, enquiryId]);
  }
  await db.query(
    `UPDATE underwriting_cases SET revised_offer_pending = 0, updated_by = @p1, updated_at = SYSUTCDATETIME()
      WHERE underwriting_case_id = @p0`, [caseId, actorId(req)]);
  await writeAudit(caseId, { action: 'REVISED_OFFER_SIGNED_UPLOADED', req, reason: `${parsed.map((f) => f.name).join(', ')} (${version})` });
  return { ok: true, ids, version };
}

async function updateLoan(caseId, body, req) {
  const enquiryService = require('./enquiry.service');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const r = await db.query(
    'SELECT underwriting_case_id, application_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [caseId]);
  if (!r.length) return { notFound: true };
  const appId = r[0].application_id;
  const gross = num(body && body.gross);
  const net = num(body && (body.net != null ? body.net : body.net_advance));
  if (gross == null || gross <= 0) return { ok: false, error: 'Enter a valid Gross Loan amount.', errors: { gross: 'Required' } };
  if (net != null && net < 0) return { ok: false, error: 'Net Advance cannot be negative.', errors: { net_advance: 'Invalid' } };
  if (net != null && net > gross) return { ok: false, error: 'Net Advance cannot exceed the Gross Loan.', errors: { net_advance: 'Too high' } };
  await db.query(
    `UPDATE applications SET amount_requested = @p1, net_advance = COALESCE(@p2, net_advance),
            updated_by = @p3, updated_at = SYSUTCDATETIME()
      WHERE application_id = @p0`, [appId, gross, net, actorId(req)]);
  // Client 15-10-2026: OUR loan's LTV (gross ÷ every security's value) + the total incl.
  // other charges, from the application's own security rows (utils/ltv).
  let ltv = null;
  try { const lp = await refreshApplicationLtv(db, appId); ltv = lp ? lp.our : null; } catch (_) { ltv = null; }
  await writeAudit(caseId, { action: 'LOAN_FIGURES_UPDATED', req,
    reason: `Gross £${gross}${net != null ? ', Net £' + net : ''}${ltv != null ? ', LTV ' + ltv + '%' : ''}` });
  return { ok: true, amount_requested: gross, net_advance: net, ltv_pct: ltv };
}

/**
 * Quick-add a Surveyor / Valuer firm from the Valuation Instruction step (client
 * 07-10-2026), mirroring the enquiry "add new broker" flow. Name is the key.
 */
async function createValuerFirm(body, req) {
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Valuer firm name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Name must be 150 characters or fewer' } };
  const email = String((body && body.email) || '').trim();
  const phone = String((body && body.phone) || '').trim();
  const firm = String((body && body.firm) || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { email: 'Enter a valid email address' } };
  if (email.length > 150) return { ok: false, errors: { email: 'Email must be 150 characters or fewer' } };
  if (phone.length > 30) return { ok: false, errors: { phone: 'Phone must be 30 characters or fewer' } };
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) return { ok: false, errors: { phone: 'Enter a valid phone number (digits only)' } };
  const dup = await db.query(
    'SELECT TOP 1 valuer_firm_id FROM valuer_firms WHERE flag_deleted = 0 AND LOWER(name) = LOWER(@p0)', [name]);
  if (dup.length) return { ok: false, errors: { name: 'A valuer firm with this name already exists' } };
  const code = 'VLR' + Date.now();
  const uidv = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `INSERT INTO valuer_firms (code, name, firm, email, phone, created_by)
     OUTPUT INSERTED.valuer_firm_id AS id, INSERTED.name AS name
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`,
    [code, name, firm || null, email || null, phone || null, uidv]);
  return { ok: true, id: out[0].id, name: out[0].name };
}

/** Edit an existing Surveyor / Valuer firm in place (client 08-10-2026): mirrors the
 *  broker add/edit on the enquiry form. The SAME record is updated, never duplicated. */
async function updateValuerFirm(id, body, req) {
  const vid = Number(id);
  if (!vid) return { ok: false, errors: { name: 'Invalid valuer firm' } };
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Valuer firm name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Name must be 150 characters or fewer' } };
  const email = String((body && body.email) || '').trim();
  const phone = String((body && body.phone) || '').trim();
  const firm = String((body && body.firm) || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { email: 'Enter a valid email address' } };
  if (email.length > 150) return { ok: false, errors: { email: 'Email must be 150 characters or fewer' } };
  if (phone.length > 30) return { ok: false, errors: { phone: 'Phone must be 30 characters or fewer' } };
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) return { ok: false, errors: { phone: 'Enter a valid phone number (digits only)' } };
  const exists = await db.query('SELECT TOP 1 valuer_firm_id FROM valuer_firms WHERE flag_deleted = 0 AND valuer_firm_id = @p0', [vid]);
  if (!exists.length) return { ok: false, notFound: true };
  const dup = await db.query(
    'SELECT TOP 1 valuer_firm_id FROM valuer_firms WHERE flag_deleted = 0 AND LOWER(name) = LOWER(@p0) AND valuer_firm_id <> @p1', [name, vid]);
  if (dup.length) return { ok: false, errors: { name: 'A valuer firm with this name already exists' } };
  const uidv = req && req.userData ? req.userData.userId : null;
  await db.query(
    `UPDATE valuer_firms SET name = @p1, firm = @p2, email = @p3, phone = @p4, updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE valuer_firm_id = @p0`,
    [vid, name, firm || null, email || null, phone || null, uidv]);
  return { ok: true, id: vid, name, firm, email, phone };
}

/**
 * Put a case On Hold / resume it (client 07-10-2026). On hold it drops out of the
 * pipeline numbers; Resume restores the status it had before.
 */
async function setHold(id, hold, req) {
  const rows = await db.query('SELECT status, status_before_hold FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0', [id]);
  if (!rows.length) return { notFound: true };
  const cur = String(rows[0].status);
  if (hold) {
    if (cur === S.ON_HOLD) return { ok: true };
    if ([S.IN_PORTFOLIO, S.REJECTED, S.CLOSED, S.RETURNED_TO_BDM].includes(cur)) return { ok: false, error: 'This case cannot be put on hold.' };
    await db.query('UPDATE underwriting_cases SET status_before_hold = @p1, status = @p2, updated_by = @p3, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0',
      [id, cur, S.ON_HOLD, actorId(req)]);
    await writeAudit(id, { action: 'CASE_ON_HOLD', from: cur, to: S.ON_HOLD, req });
  } else {
    if (cur !== S.ON_HOLD) return { ok: true };
    const back = rows[0].status_before_hold || S.IN_PROGRESS;
    await db.query('UPDATE underwriting_cases SET status = @p1, status_before_hold = NULL, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE underwriting_case_id = @p0',
      [id, back, actorId(req)]);
    await writeAudit(id, { action: 'CASE_RESUMED', from: S.ON_HOLD, to: back, req });
  }
  return { ok: true };
}

/** Add a Solicitor firm to the master (client 09-10-2026): mirrors the Valuer Firm
 *  add/edit so a new solicitor can be created from the Solicitor Quote step. */
async function createSolicitor(body, req) {
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Solicitor name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Name must be 150 characters or fewer' } };
  const email = String((body && body.email) || '').trim();
  const phone = String((body && body.phone) || '').trim();
  const firm = String((body && body.firm) || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { email: 'Enter a valid email address' } };
  if (email.length > 150) return { ok: false, errors: { email: 'Email must be 150 characters or fewer' } };
  if (phone.length > 30) return { ok: false, errors: { phone: 'Phone must be 30 characters or fewer' } };
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) return { ok: false, errors: { phone: 'Enter a valid phone number (digits only)' } };
  const dup = await db.query(
    'SELECT TOP 1 solicitor_id FROM solicitors WHERE flag_deleted = 0 AND LOWER(name) = LOWER(@p0)', [name]);
  if (dup.length) return { ok: false, errors: { name: 'A solicitor with this name already exists' } };
  const code = 'SOL' + Date.now();
  const uidv = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `INSERT INTO solicitors (code, name, firm, email, phone, created_by)
     OUTPUT INSERTED.solicitor_id AS id, INSERTED.name AS name, INSERTED.firm AS firm, INSERTED.email AS email, INSERTED.phone AS phone
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`,
    [code, name, firm || null, email || null, phone || null, uidv]);
  const row = out[0];
  return { ok: true, id: row.id, name: (row.firm || row.name), sol_name: row.name, firm: row.firm, email: row.email, phone: row.phone };
}

/** Edit an existing Solicitor master in place — the SAME record, never duplicated. */
async function updateSolicitor(id, body, req) {
  const sid = Number(id);
  if (!sid) return { ok: false, errors: { name: 'Invalid solicitor' } };
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Solicitor name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Name must be 150 characters or fewer' } };
  const email = String((body && body.email) || '').trim();
  const phone = String((body && body.phone) || '').trim();
  const firm = String((body && body.firm) || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { email: 'Enter a valid email address' } };
  if (email.length > 150) return { ok: false, errors: { email: 'Email must be 150 characters or fewer' } };
  if (phone.length > 30) return { ok: false, errors: { phone: 'Phone must be 30 characters or fewer' } };
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) return { ok: false, errors: { phone: 'Enter a valid phone number (digits only)' } };
  const exists = await db.query('SELECT TOP 1 solicitor_id FROM solicitors WHERE flag_deleted = 0 AND solicitor_id = @p0', [sid]);
  if (!exists.length) return { ok: false, notFound: true };
  const dup = await db.query(
    'SELECT TOP 1 solicitor_id FROM solicitors WHERE flag_deleted = 0 AND LOWER(name) = LOWER(@p0) AND solicitor_id <> @p1', [name, sid]);
  if (dup.length) return { ok: false, errors: { name: 'A solicitor with this name already exists' } };
  const uidv = req && req.userData ? req.userData.userId : null;
  await db.query(
    `UPDATE solicitors SET name = @p1, firm = @p2, email = @p3, phone = @p4, updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE solicitor_id = @p0`,
    [sid, name, firm || null, email || null, phone || null, uidv]);
  return { ok: true, id: sid, name: (firm || name), sol_name: name, firm: firm || null, email: email || null, phone: phone || null };
}

/**
 * Build the Credit Paper (Credit Deal Summary) as a Word .docx for a case
 * (client 09-10-2026): numbers auto-filled from the accepted offer / indicative
 * (same figures as the Credit Deal Summary PDF), narrative sections left blank for
 * the underwriter to complete offline. Variant chosen by applicant type.
 */
async function creditPaperDocx(caseId) {
  const enquiryService = require('./enquiry.service');
  const { buildCreditPaperDocx } = require('./pdf/credit-paper-docx.service');
  // Local date formatter (dd/mm/yyyy) — the one in loadStep's scope is not visible here.
  const dmy = (v) => {
    const t = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('/') : (v || null);
  };
  const c = await getCase(caseId);
  if (!c) return { notFound: true };
  if (!c.enquiry_id) return { ok: false, error: 'This application has no source enquiry to build the credit paper from.' };
  const enquiry = await enquiryService.getById(c.enquiry_id);
  if (!enquiry) return { ok: false, error: 'Source enquiry not found.' };
  const terms = await enquiryService.agreedTerms(c.enquiry_id, enquiry);
  // Tester 20-10-2026: after "Edit loan" the Arrangement / Broker / Document Fee printed blank -
  // agreedTerms() can come back without a fee pack (e.g. the enquiry's quick offer amount), while
  // the edited terms are always written to applications.agreed_terms. Fill any missing pack
  // figure from that snapshot so the credit paper shows what the indicative / offer showed.
  try {
    const ar = await db.query('SELECT agreed_terms FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [c.application_id]);
    const snap = ar.length ? (safeJson(ar[0].agreed_terms) || {}) : {};
    if (snap && Object.keys(snap).length) {
      const pack = { ...(terms.pack || {}) };
      for (const [k, v] of Object.entries(snap)) {
        if (v === null || v === undefined || v === '') continue;
        if (pack[k] === null || pack[k] === undefined || pack[k] === '') pack[k] = v;
      }
      terms.pack = pack;
      if (terms.value == null && snap.gross_loan_amount != null) terms.value = Number(snap.gross_loan_amount);
      if (terms.ratePct == null && snap.monthly_rate_pct != null) terms.ratePct = Number(snap.monthly_rate_pct);
    }
  } catch (e) { /* no snapshot - keep agreedTerms as is */ }

  // Valuation (step 2): the accepted valuation's type + valuer, else the first entry.
  let valuationType = '', valuer = '', valMarketValue = null, valConfidence = null;
  try {
    const s2 = await loadStep(caseId, 2);
    const f2 = ((safeJson(s2 && s2.data) || {}).fields) || {};
    const ents = Array.isArray(f2.entries) ? f2.entries : [];
    // Client 22-10-2026: several valuations (e.g. one per security) -> list every type / valuer.
    const okEnts = ents.filter((x) => x && ['accepted', 'approved'].includes(String(x.status || '').toLowerCase()));
    const use = okEnts.length ? okEnts : (ents.length ? ents : [f2]);
    const uniq = (k) => [...new Set(use.map((x) => String((x && x[k]) || '').trim()).filter(Boolean))].join(', ');
    valuationType = uniq('valuation_type');
    valuer = uniq('valuer_firm');
    // Report details (client 15-10-2026): market value + AVM confidence level for the paper.
    const mv = Number(f2.market_value);
    valMarketValue = Number.isFinite(mv) && mv > 0 ? mv : null;
    valConfidence = f2.confidence_level != null && String(f2.confidence_level).trim() !== '' ? String(f2.confidence_level).trim() : null;
  } catch (e) { /* no valuation step data */ }

  // Dual representation (step 4 Solicitor Quote). Defaults to No (single rep) when unset.
  let dualRep = 'No';
  try {
    const s4 = await loadStep(caseId, 4);
    const f4 = ((safeJson(s4 && s4.data) || {}).fields) || {};
    // Not chosen in underwriting yet -> the enquiry's choice (client 15-10-2026).
    dualRep = /dual/i.test(String(f4.rep_type || enquiry.rep_type || '')) ? 'Yes' : 'No';
  } catch (e) { /* no solicitor step data */ }

  // Risk mitigants + recommendation (step 6 Underwrite & Findings / "Underwriting Review").
  let riskMitigants = '';
  try {
    const s6 = await loadStep(caseId, 6);
    const d6 = (safeJson(s6 && s6.data) || {});
    const f6 = d6.fields || {};
    riskMitigants = [f6.risk_finding, d6.recommendation].filter((x) => x && String(x).trim()).join('\n\n');
  } catch (e) { /* no findings step data */ }

  // Borrower Background & Experience — from the enquiry's applicant(s).
  const bgLine = (ap) => {
    if (!ap) return '';
    const bits = [
      ap.nationality ? `Nationality: ${ap.nationality}` : null,
      ap.dob ? `DOB: ${dmy(ap.dob)}` : null,
      ap.mobile ? `Mobile: ${ap.mobile}` : null,
      ap.email ? `Email: ${ap.email}` : null,
      ap.address ? `Address: ${ap.address}` : null,
      ap.occupation ? `Occupation: ${ap.occupation}${ap.employer_name ? ' at ' + ap.employer_name : ''}` : null,
    ].filter(Boolean);
    const name = ap.full_name || '';
    // Client 14-10-2026: each point on its own line (the "; " run-on was hard to read).
    return [name, ...bits].filter(Boolean).join('\n');
  };
  const borrowerBackground = (Array.isArray(enquiry.applicants) ? enquiry.applicants : [])
    .map(bgLine).filter(Boolean).join('\n\n') || '';

  // Site visit (step 9).
  let siteVisit = '';
  try {
    const s9 = await loadStep(caseId, 9);
    const f9 = ((safeJson(s9 && s9.data) || {}).fields) || {};
    const dt = f9.site_visit_date || f9.visit_date || '';
    siteVisit = [dt ? dmy(dt) : null, f9.site_visit_by || f9.visited_by || f9.initials || null].filter(Boolean).join(' - ');
  } catch (e) { /* no site visit step data */ }

  // Lender income -> Total Gross Profit (when captured on the application).
  let lenderIncome = null;
  try {
    const ar = await db.query('SELECT lender_income FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [c.application_id]);
    lenderIncome = ar.length && ar[0].lender_income != null ? Number(ar[0].lender_income) : null;
  } catch (e) { /* ignore */ }

  // Credit Recommendation line (client 13-10-2026): name the deal's credit team —
  // BDM, underwriter and broker — rather than leaving it blank.
  const oxford = (arr) => { const a = [...new Set(arr.map((x) => String(x || '').trim()).filter(Boolean))]; if (!a.length) return ''; if (a.length === 1) return a[0]; if (a.length === 2) return `${a[0]} and ${a[1]}`; return `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`; };
  const teamNames = oxford([c.bdm_name, c.underwriter_name, c.broker_name]);
  const creditRecommendation = teamNames ? `This loan is recommended by the credit team consisting of ${teamNames}.` : '';

  const extra = {
    fileOwner: c.bdm_name || enquiry.assigned_to_name || '',
    underwriter: c.underwriter_name || '',
    creditRecommendation,
    valuationType, valuer, siteVisit, dualRep,
    riskMitigants, borrowerBackground,
    irrPct: c.irr_pct != null ? Number(c.irr_pct) : null,
    totalGrossProfit: lenderIncome,
    purchasePrice: enquiry.purchase_price != null ? enquiry.purchase_price : null,
    marketValue: valMarketValue,
    confidenceLevel: valConfidence,
    introducer: {
      name: c.broker_name || enquiry.broker_name || enquiry.broker_name_text || '',
      // Contact person (not the company) for the Arrangement Fee bullets (client 19-10-2026).
      contact: c.broker_contact_name || enquiry.broker_name || enquiry.broker_name_text || '',
      email: c.broker_email || enquiry.broker_email || '',
      phone: c.broker_phone || enquiry.broker_phone || '',
    },
  };

  const buffer = await buildCreditPaperDocx(enquiry, terms, extra);
  const borrower = enquiry.company_name || enquiry.applicant_name || 'Borrower';
  const appRef = c.application_ref || ('APP-' + c.application_id);
  const fileName = `Credit Paper - ${appRef} - ${borrower}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
  return { ok: true, buffer, fileName, applicationId: c.application_id };
}

/* ------------------------------------------------------------------ */
/*  Borrower's Solicitor master + per-solicitor checks (16-10-2026)    */
/* ------------------------------------------------------------------ */

/**
 * Add / edit a Borrower's Solicitor from the Solicitor Quote step - the same master and
 * validation as the New Enquiry popup (enquiry.service), plus the SRA / regulator number.
 */
async function saveBorrowerSolicitor(id, body, req) {
  const enquiryService = require('./enquiry.service');
  const sra = String((body && body.sra_no) || '').trim();
  if (sra.length > 50) return { ok: false, errors: { sra_no: 'SRA / regulator number must be 50 characters or fewer' } };
  const out = id ? await enquiryService.updateSolicitor(id, body || {}, req) : await enquiryService.createSolicitor(body || {}, req);
  if (!out || out.notFound) return { notFound: true };
  if (!out.ok) return out;
  await db.query('UPDATE borrower_solicitors SET sra_no = @p1 WHERE borrower_solicitor_id = @p0', [out.id, sra || null]).catch(() => {});
  return { ...out, name: out.firm, firm_name: out.firm, sra_no: sra || null };
}

/**
 * Checks + evidence saved for a solicitor across every case (client 16-10-2026): picking a
 * solicitor used before pre-fills its checks; `updated_at` lets the underwriter see how old
 * each check is and redo stale ones.
 */
async function borrowerSolicitorChecks(solId) {
  const sid = Number(solId);
  if (!Number.isFinite(sid) || sid <= 0) return { notFound: true };
  const s = await db.query('SELECT borrower_solicitor_id FROM borrower_solicitors WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0', [sid]);
  if (!s.length) return { notFound: true };
  const checks = await db.query(
    `SELECT c.solicitor_check_item_id AS check_id, c.done, c.notes, COALESCE(c.updated_at, c.created_at) AS updated_at,
            u.full_name AS updated_by_name
       FROM borrower_solicitor_checks c
       LEFT JOIN users u ON u.user_id = COALESCE(c.updated_by, c.created_by)
      WHERE c.borrower_solicitor_id = @p0`, [sid]);
  const docs = await db.query(
    `SELECT borrower_solicitor_document_id AS id, solicitor_check_item_id AS check_id, file_name, content_type, created_at
       FROM borrower_solicitor_documents WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0
      ORDER BY borrower_solicitor_document_id DESC`, [sid]);
  const map = {};
  for (const c of checks) {
    map[String(c.check_id)] = { done: !!c.done, notes: c.notes || '', updated_at: c.updated_at, updated_by_name: c.updated_by_name || null };
  }
  // A newer upload counts as the check being refreshed.
  for (const d of docs) {
    const k = String(d.check_id);
    if (!map[k]) continue;
    if (!map[k].updated_at || new Date(d.created_at) > new Date(map[k].updated_at)) map[k].updated_at = d.created_at;
  }
  return { ok: true, checks: map, docs };
}

/** Tick / untick a check (and its notes) for a solicitor. body = { done, notes, case_id } */
async function saveBorrowerSolicitorCheck(solId, checkId, body, req) {
  const sid = Number(solId); const cid = Number(checkId);
  if (!(sid > 0) || !(cid > 0)) return { ok: false, error: 'Invalid solicitor or check' };
  const s = await db.query('SELECT 1 FROM borrower_solicitors WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0', [sid]);
  if (!s.length) return { notFound: true };
  const notes = body && body.notes != null ? String(body.notes) : null;
  const bad = overLimit('Notes', notes, LIMITS.free_text);
  if (bad) return { ok: false, error: bad, errors: { notes: bad } };
  const done = body && body.done === true ? 1 : 0;
  await db.query(
    `MERGE borrower_solicitor_checks AS t
     USING (SELECT @p0 AS sid, @p1 AS cid) AS s ON t.borrower_solicitor_id = s.sid AND t.solicitor_check_item_id = s.cid
     WHEN MATCHED THEN UPDATE SET done = @p2, notes = COALESCE(@p3, t.notes), updated_by = @p4, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (borrower_solicitor_id, solicitor_check_item_id, done, notes, created_by, updated_by, updated_at)
       VALUES (@p0, @p1, @p2, @p3, @p4, @p4, SYSUTCDATETIME());`,
    [sid, cid, done, notes, actorId(req)]);
  const caseId = Number(body && body.case_id);
  if (caseId > 0) await writeAudit(caseId, { stepNo: 4, action: 'SOLICITOR_CHECK_SAVED', req, reason: `solicitor ${sid}, check ${cid}: ${done ? 'done' : 'not done'}` }).catch(() => {});
  return { ok: true };
}

const BS_DOC_DIR = path.join('uploads', 'borrower_solicitor_documents');

async function addBorrowerSolicitorDoc(solId, checkId, body, req) {
  const sid = Number(solId); const cid = Number(checkId);
  const s = await db.query('SELECT 1 FROM borrower_solicitors WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0', [sid]);
  if (!s.length) return { notFound: true };
  const name = String((body && body.file_name) || '').trim();
  const b64 = String((body && body.content_base64) || '');
  if (!name || !b64) return { ok: false, error: 'file_name and content_base64 are required' };
  const badName = overLimit('File name', name, LIMITS.file_name);
  if (badName) return { ok: false, error: badName };
  let ctype = (b64.match(/^data:([^;]+);base64,/) || [])[1] || (body && body.content_type) || 'application/octet-stream';
  if (String(ctype).length > LIMITS.content_type) ctype = String(ctype).slice(0, LIMITS.content_type);
  const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buf.length) return { ok: false, error: 'File is empty or not valid base64' };
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), BS_DOC_DIR, String(sid));
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = Date.now() + '_' + name.replace(/[^\w.\-]+/g, '_');
  fs.writeFileSync(path.join(absDir, safe), buf);
  const caseId = Number(body && body.case_id) > 0 ? Number(body.case_id) : null;
  const out = await db.query(
    `INSERT INTO borrower_solicitor_documents (borrower_solicitor_id, solicitor_check_item_id, underwriting_case_id, file_name, file_path, content_type, uploaded_by)
     OUTPUT INSERTED.borrower_solicitor_document_id AS id VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)`,
    [sid, cid > 0 ? cid : null, caseId, name, path.join(BS_DOC_DIR, String(sid), safe).replace(/\\/g, '/'), ctype, actorId(req)]);
  if (caseId) await writeAudit(caseId, { stepNo: 4, action: 'SOLICITOR_CHECK_DOC_UPLOADED', req, reason: name }).catch(() => {});
  return { ok: true, id: out[0] ? out[0].id : null };
}

async function getBorrowerSolicitorDoc(solId, docId) {
  const rows = await db.query(
    `SELECT file_name, file_path, content_type FROM borrower_solicitor_documents
      WHERE borrower_solicitor_document_id = @p0 AND borrower_solicitor_id = @p1 AND flag_deleted = 0`, [Number(docId), Number(solId)]);
  if (!rows.length) return null;
  const abs = path.join(global.basePath || path.join(__dirname, '..'), rows[0].file_path);
  if (!fs.existsSync(abs)) return null;
  return { file_name: rows[0].file_name, content_type: rows[0].content_type, buffer: fs.readFileSync(abs) };
}

async function deleteBorrowerSolicitorDoc(solId, docId, req) {
  await db.query(
    `UPDATE borrower_solicitor_documents SET flag_deleted = 1
      WHERE borrower_solicitor_document_id = @p0 AND borrower_solicitor_id = @p1`, [Number(docId), Number(solId)]);
  return { ok: true };
}

/**
 * Solicitor Quote "Additional costs" names (client 16-10-2026): add / rename a Solicitor Cost
 * Type from the step's dropdown - the same master as Masters > Solicitor Cost Types.
 */
async function saveSolicitorCostType(id, body, req) {
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Cost name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Cost name must be 150 characters or fewer' } };
  if (!/^[A-Za-z0-9 .,&/'()\-]+$/.test(name)) return { ok: false, errors: { name: 'Cost name may only contain letters, numbers, spaces and . , & / \' ( ) -' } };
  const cid = Number(id) || 0;
  const dup = await db.query(
    'SELECT TOP 1 solicitor_cost_type_id FROM solicitor_cost_types WHERE flag_deleted = 0 AND LOWER(name) = LOWER(@p0) AND solicitor_cost_type_id <> @p1', [name, cid]);
  if (dup.length) return { ok: false, errors: { name: 'A cost type with this name already exists - pick it from the list' } };
  if (cid) {
    const ex = await db.query('SELECT 1 FROM solicitor_cost_types WHERE solicitor_cost_type_id = @p0 AND flag_deleted = 0', [cid]);
    if (!ex.length) return { notFound: true };
    await db.query('UPDATE solicitor_cost_types SET name = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE solicitor_cost_type_id = @p0',
      [cid, name, actorId(req)]);
    return { ok: true, id: cid, name };
  }
  const n = await db.query(`SELECT MAX(TRY_CONVERT(INT, SUBSTRING(code, 5, 20))) AS n FROM solicitor_cost_types WHERE code LIKE 'SCT-%'`);
  const code = 'SCT-' + String(((n[0] && n[0].n) || 0) + 1).padStart(4, '0');
  const out = await db.query(
    `INSERT INTO solicitor_cost_types (code, name, sort_order, created_by)
     OUTPUT INSERTED.solicitor_cost_type_id AS id, INSERTED.name AS name
     VALUES (@p0, @p1, NULL, @p2)`, [code, name, actorId(req)]);
  return { ok: true, id: out[0].id, name: out[0].name };
}

module.exports = {
  getSignedOffer, setHold,
  saveNotes, updateLoan, saveIndicativeEdit, createValuerFirm, updateValuerFirm, createSolicitor, updateSolicitor, uploadCreditSummary, sendFinalCreditPaper, creditPaperDocx,
  syncKycToApplication,
  ensureCase, seedSteps, list, getCase, accept,
  addPhoto, listPhotos, getPhoto, deletePhoto,
  saveStep, completeStep, decide, raiseQuery, respondQuery, rejectCase, returnToBdm, meta, stageCounts, canActStep, withStepAccess,
  sendRequirementsToBroker, applyCreditDecision, reopenCase, completeMergedStep, referToCredit,
  // client 16-10-2026
  listCaseDocuments, uploadRevisedSignedOffer, saveBorrowerSolicitor, borrowerSolicitorChecks, saveBorrowerSolicitorCheck,
  addBorrowerSolicitorDoc, getBorrowerSolicitorDoc, deleteBorrowerSolicitorDoc, saveSolicitorCostType, solicitorChecksStatus,
};
