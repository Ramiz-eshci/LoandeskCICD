'use strict';

/**
 * Application service (Module-5). ALL business logic lives here so the
 * controller stays a thin HTTP layer (mirrors services/enquiry.service.js):
 *   - server-side validation & coercion from config/application.config.js
 *   - list (search / filter / sort / paginate) with joins for the pipeline table
 *   - getById: the full detail payload for the 10 Figma tabs
 *       (summary, applicant, loan details, security, broker, documents,
 *        tasks, communications, audit, enquiry details)
 *   - status changes (forward-only pipeline + super-admin override)
 *   - tasks / communications / notes CRUD
 *   - documents (list via getById; upload/verify/delete)
 *   - counts (stage chips) and formOptions (dropdowns)
 *
 * A03 Injection: values are always bound (@pN); identifiers come only from the
 * trusted config, never from the request.
 */

const fs = require('fs');
const fileGuard = require('../utils/fileGuard');
const path = require('path');
const db = require('../config/database');
const { latestGrossApply, appBasisSql, appAmountBasisSql, appNetSql } = require('../utils/loanAmount');
const { scopeWhere } = require('../middlewares/application-scope');
const audit = require('./audit.service');
// Underwriting rows live in their own table; borrow the reshaper rather than
// duplicating the query. Required lazily to avoid a circular import at load.
const enquirySvcTrail = (caseId) => require('./enquiry.service').underwritingTrail(caseId);
const CFG = require('../config/application.config');
const underwriting = require('./underwriting.service');
const mail = require('./mail.service');
const { totalLtv } = require('../utils/ltv');
const emailHub = require('./emailHub.service');

const { textError } = require('../utils/textRules');
const RX = {
  text: /^[A-Za-z0-9 .,&/'()\-#:%\n\r]+$/,
  phone: /^[0-9+()\-\s]+$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
};

/** Acting user id, or null for an unauthenticated/system call. */
const actorId = (req) => (req && req.userData ? req.userData.userId : null);

const int = (v, d = null) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/** Reject anything longer than the column can hold, naming the limit. */
function tooLong(col, v) {
  return col.max && String(v).length > col.max
    ? `Must be ${col.max} characters or fewer (currently ${String(v).length})`
    : null;
}
/** Keep a number inside both the SQL type and common sense. */
function outOfRange(col, n) {
  if (col.min != null && n < col.min) return `Must be ${col.min} or more`;
  if (col.max != null && n > col.max) return `Must be ${col.max} or less`;
  return null;
}

/** Validate + coerce a request body against the config field list. */
function validate(body, { partial = false, fields = CFG.FIELDS } = {}) {
  const errors = {};
  const values = {};
  for (const col of fields) {
    const has = Object.prototype.hasOwnProperty.call(body, col.name);
    if (partial && !has) continue;
    const raw = body[col.name];
    if (raw === undefined || raw === null || raw === '') {
      if (col.required && !partial) errors[col.name] = 'This field is required';
      else values[col.name] = null;
      continue;
    }
    const v = typeof raw === 'string' ? raw.trim() : raw;
    switch (col.type) {
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n)) { errors[col.name] = 'Must be a whole number'; break; }
        const bad = outOfRange(col, n);
        if (bad) errors[col.name] = bad; else values[col.name] = n;
        break;
      }
      case 'decimal': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) { errors[col.name] = 'Must be a valid amount'; break; }
        const bad = outOfRange(col, n);
        if (bad) errors[col.name] = bad; else values[col.name] = n;
        break;
      }
      case 'select': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) errors[col.name] = 'Please select a valid option';
        else values[col.name] = n;
        break;
      }
      case 'email':
        if (!RX.email.test(String(v))) errors[col.name] = 'Enter a valid email address';
        else if (tooLong(col, v)) errors[col.name] = tooLong(col, v);
        else values[col.name] = String(v);
        break;
      case 'phone':
        if (!RX.phone.test(String(v))) errors[col.name] = 'Enter a valid phone number';
        else if (tooLong(col, v)) errors[col.name] = tooLong(col, v);
        else values[col.name] = String(v);
        break;
      case 'date': {
        const str = String(v).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) errors[col.name] = 'Enter a valid date';
        else values[col.name] = str;
        break;
      }
      case 'bool':
        // Yes/No radios arrive as strings from the form; 0/1 from the API.
        values[col.name] = (v === true || v === 1 || v === '1' || v === 'true' || v === 'Yes') ? 1 : 0;
        break;
      case 'longtext': {
        // Free-text notes: only strip control characters, never the punctuation
        // RX.text forbids - a borrower summary may legitimately contain any of it.
        const long = tooLong(col, v);
        if (long) errors[col.name] = long;
        else values[col.name] = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
        break;
      }
      default: {
        const long = tooLong(col, v);
        if (!RX.text.test(String(v))) errors[col.name] = 'Contains characters that are not allowed';
        else if (long) errors[col.name] = long;
        else values[col.name] = String(v);
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

/** Auto-generate a unique application reference: APP-YYYY-NNNNN. */
async function generateRef() {
  const year = new Date().getFullYear();
  const prefix = `${CFG.REF_PREFIX}-${year}-`;
  const rows = await db.query(
    `SELECT TOP 1 application_ref FROM applications WHERE application_ref LIKE @p0 ORDER BY application_ref DESC`,
    [prefix + '%'],
  );
  let next = 1;
  if (rows.length) {
    const n = parseInt(String(rows[0].application_ref).slice(prefix.length), 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  return prefix + String(next).padStart(5, '0');
}

const stageOf = (code) => CFG.STAGE_OF[String(code || '').toUpperCase()] || 'submitted';

/* ------------------------------------------------------------------ */
/*  LIST                                                               */
/* ------------------------------------------------------------------ */

const SELECT_LIST = `
  a.application_id, a.application_ref, a.amount_requested, a.term_months,
  a.ltv_pct, a.enquiry_id, a.branch_id,
  -- Client 19-10-2026: list shows Total LTV - same order as the detail Summary tab
  -- (application's own, else the enquiry's, else our own LTV when there are no other charges).
  COALESCE(a.total_ltv_pct, enq.total_ltv_pct, a.ltv_pct) AS total_ltv_pct, a.product_id, a.assigned_to,
  a.underwriter_id, a.application_status_id, a.initial_offer_state,
  a.initial_offer_note, a.sla_days, a.submitted_at, a.created_at,
  st.code AS status_code, st.name AS status_name,
  b.branch_name, p.name AS product_name,
  bdm.full_name AS bdm_name, uw.full_name AS underwriter_name,
  ap.applicant_id, ap.first_name, ap.last_name, ap.company_name, ap.email AS ap_email, ap.phone AS ap_phone,
  atp.name AS applicant_type_name,
  enq.applicant_name AS enq_applicant_name, enq.company_name AS enq_company_name, enq.email AS enq_email, enq.phone AS enq_phone,
  -- 'Gross' | 'Net' for the amount column (client 15-10-2026), see utils/loanAmount.
  ${appBasisSql('enq')} AS loan_basis,
  ${appAmountBasisSql('enq')} AS amount_basis,
  ${appNetSql('enq', 'a')} AS net_loan`;

const JOINS = `
  FROM applications a
  LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
  LEFT JOIN branches b   ON b.branch_id = a.branch_id
  LEFT JOIN products p   ON p.product_id = a.product_id
  LEFT JOIN users bdm    ON bdm.user_id = a.assigned_to
  LEFT JOIN users uw     ON uw.user_id = a.underwriter_id
  LEFT JOIN application_applicants aa
         ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
  LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
  LEFT JOIN applicant_types atp ON atp.applicant_type_id = ap.applicant_type_id
  LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
  ${latestGrossApply('enq')}`;

function shapeListRow(r) {
  const name = r.company_name
    || [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
    || r.enq_company_name
    || r.enq_applicant_name
    || null;
  return {
    application_id: r.application_id,
    application_ref: r.application_ref,
    applicant_name: name || '—',
    applicant_company: r.company_name || null,
    // Client 16-10-2026: same as the Enquiries list - name, then email (else phone) below.
    applicant_contact: r.ap_email || r.enq_email || r.ap_phone || r.enq_phone || null,
    product_name: r.product_name || '—',
    amount_requested: r.amount_requested,
    loan_basis: r.loan_basis || 'Gross',
    amount_basis: r.amount_basis || 'Gross',
    net_loan: r.net_loan != null ? r.net_loan : null,
    term_months: r.term_months,
    ltv_pct: r.ltv_pct,
    total_ltv_pct: r.total_ltv_pct != null ? Number(r.total_ltv_pct) : null,
    bdm_name: r.bdm_name || '—',
    underwriter_name: r.underwriter_name || '—',
    status_code: r.status_code,
    status_name: r.status_name || '—',
    stage_key: stageOf(r.status_code),
    initial_offer_state: r.initial_offer_state || null,
    initial_offer_note: r.initial_offer_note || null,
    sla_days: r.sla_days,
    enquiry_id: r.enquiry_id,
    created_at: r.created_at,
  };
}

async function list(q, opts = {}) {
  const page = Math.max(1, int(q.page, 1));
  const per = Math.min(5000, /* pagination removed (client 21-10-2026) - was 100 */ Math.max(1, int(q.per_page, 10)));
  const p = {};
  let where = 'a.flag_deleted = 0';

  const search = String(q.search || '').trim();
  if (search) {
    where += ` AND (a.application_ref LIKE @search
      OR ap.first_name LIKE @search OR ap.last_name LIKE @search OR ap.company_name LIKE @search)`;
    p.search = '%' + search + '%';
  }
  if (String(q.stage || '').trim()) {
    // Client 16-10-2026: 'live' = Awaiting Initial Review + Underwriting + Approved (the
    // same statuses those three chips count); it is the default view.
    if (String(q.stage).toLowerCase() === 'live') {
      const live = Object.keys(CFG.STAGE_OF).filter((c) => LIVE_STAGES.includes(CFG.STAGE_OF[c]));
      where += ' AND st.code IN (' + live.map((c, i) => { p['live_code' + i] = c; return '@live_code' + i; }).join(', ') + ')';
    } else {
      // Every status the chip COUNTS under this stage (STAGE_OF), not just one code: the
      // Submitted chip counts DRAFT ("Awaiting Initial Review") + SUBMITTED, so the list must
      // show both (client 15-10-2026: chip said 30, list showed 2).
      const st = String(q.stage).toLowerCase();
      let codes = Object.keys(CFG.STAGE_OF).filter((c) => CFG.STAGE_OF[c] === st);
      if (!codes.length) codes = [codeForStage(q.stage)];
      where += ' AND st.code IN (' + codes.map((c, i) => { p['stage_code' + i] = c; return '@stage_code' + i; }).join(', ') + ')';
    }
  }
  if (String(q.status_code || '').trim()) { where += ' AND st.code = @status_code'; p.status_code = String(q.status_code).toUpperCase(); }
  if (int(q.status_id)) { where += ' AND a.application_status_id = @status_id'; p.status_id = int(q.status_id); }
  if (int(q.assigned_to)) { where += ' AND a.assigned_to = @assigned_to'; p.assigned_to = int(q.assigned_to); }
  if (int(q.underwriter_id)) { where += ' AND a.underwriter_id = @underwriter_id'; p.underwriter_id = int(q.underwriter_id); }
  if (int(q.branch_id)) { where += ' AND a.branch_id = @branch_id'; p.branch_id = int(q.branch_id); }
  if (int(q.product_id)) { where += ' AND a.product_id = @product_id'; p.product_id = int(q.product_id); }
  // view scope: without APPLICATIONS.ALL_APPLICATIONS.view only own (assigned) applications
  if (opts.scopeUserId !== undefined && opts.scopeUserId !== null) {
    where += scopeWhere('scope_uid'); p.scope_uid = int(opts.scopeUserId, 0);
  }
  // "My deals" toggle (same as Underwriting): only applications where this user is the BDM.
  if (int(q.mine) && int(opts.currentUserId)) { where += ' AND a.assigned_to = @me'; p.me = int(opts.currentUserId); }

  const sortCol = CFG.SORTABLE.includes(String(q.sort)) ? String(q.sort) : 'application_id';
  const sortDir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  p.off = (page - 1) * per;
  p.lim = per;
  // Client 19-10-2026: default order (every tab) = most recently updated first, so a deal you
  // just worked on (e.g. sent to underwriting) stays at the top. Replaces the 15-10-2026
  // pipeline-stage grouping on the Live view. An explicit sort still wins.
  const orderBy = !q.sort
    ? 'ISNULL(a.updated_at, a.created_at) DESC, a.application_id DESC'
    : `a.${sortCol} ${sortDir}`;
  const rows = await db.queryNamed(
    `SELECT ${SELECT_LIST} ${JOINS} WHERE ${where}
     ORDER BY ${orderBy} OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
    p,
  );
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total ${JOINS} WHERE ${where}`, p);
  const total = cnt[0] ? cnt[0].total : 0;
  return { rows: rows.map(shapeListRow), meta: { page, per_page: per, total, total_pages: Math.ceil(total / per) || 1 } };
}

/** Stages shown under the Live chip (client 16-10-2026). */
const LIVE_STAGES = ['awaiting-review', 'underwriting', 'approved'];

/** Resolve a front-end stage key -> a status code for filtering. */
function codeForStage(stage) {
  const s = String(stage || '').toLowerCase();
  const map = {
    'awaiting-review': 'DRAFT', underwriting: 'UNDERWRITING', 'credit-review': 'UNDERWRITING',
    approved: 'APPROVED', legal: 'APPROVED', completed: 'COMPLETED', declined: 'DECLINED',
  };
  return map[s] || String(stage).toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  GET BY ID — full detail payload (all tabs)                        */
/* ------------------------------------------------------------------ */

async function getById(id) {
  const rows = await db.query(
    `SELECT a.*,
            st.code AS status_code, st.name AS status_name,
            b.branch_name, p.name AS product_name, lp.name AS purpose_name,
            src.name AS source_name, br.name AS broker_name,
            -- Broker company + contact (client 15-10-2026): the panel broker on the
            -- application, else the one picked on the source enquiry.
            COALESCE(NULLIF(br.company, ''), NULLIF(ebr.company, '')) AS broker_company,
            COALESCE(br.email, ebr.email) AS broker_email, COALESCE(br.phone, ebr.phone) AS broker_phone,
            ebr.name AS enquiry_broker_name,
            -- a.broker_name (free text, carried from the enquiry) is shadowed by
            -- the broker-table alias above, so re-expose it under the same name
            -- enquiry.service uses. Both are real: one is the panel broker on
            -- record, the other whatever the introducer was called on the enquiry.
            a.broker_name AS broker_name_text,
            rt.name AS rate_name, rf.name AS repayment_frequency_name,
            bdm.full_name AS bdm_name, bdm.email AS bdm_email,
            uw.full_name AS underwriter_name, cm.full_name AS credit_manager_name,
            e.enquiry_ref, e.applicant_name AS enq_applicant_name, e.company_name AS enq_company_name,
            -- The open underwriting case, so Application Detail can link straight
            -- into it (mirrors "View Application" on the underwriting side).
            -- Null until the application is sent to underwriting.
            (SELECT TOP 1 uc.underwriting_case_id
               FROM underwriting_cases uc
              WHERE uc.application_id = a.application_id AND uc.flag_deleted = 0
              ORDER BY uc.underwriting_case_id DESC) AS underwriting_case_id,
            ${appBasisSql('e')} AS loan_basis,
            ${appAmountBasisSql('e')} AS amount_basis,
            ${appNetSql('e', 'a')} AS net_loan
       FROM applications a
       LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
       LEFT JOIN branches b   ON b.branch_id = a.branch_id
       LEFT JOIN products p   ON p.product_id = a.product_id
       LEFT JOIN loan_purposes lp ON lp.loan_purpose_id = a.loan_purpose_id
       LEFT JOIN application_sources src ON src.application_source_id = a.application_source_id
       LEFT JOIN brokers br   ON br.broker_id = a.broker_id
       LEFT JOIN interest_rates rt ON rt.rate_id = a.rate_id
       LEFT JOIN repayment_frequencies rf ON rf.repayment_frequency_id = a.repayment_frequency_id
       LEFT JOIN users bdm    ON bdm.user_id = a.assigned_to
       LEFT JOIN users uw     ON uw.user_id = a.underwriter_id
       LEFT JOIN users cm     ON cm.user_id = a.credit_manager_id
       LEFT JOIN enquiries e  ON e.enquiry_id = a.enquiry_id
       LEFT JOIN brokers ebr  ON ebr.broker_id = e.broker_id
       ${latestGrossApply('e')}
      WHERE a.application_id = @p0 AND a.flag_deleted = 0`,
    [id],
  );
  if (!rows.length) return null;
  const app = rows[0];
  // a.* already carries a broker_name column (free text from the enquiry) and the query
  // also selects br.name AS broker_name: mssql then returns BOTH as an array, which the
  // Broker tab printed as "Patrick Jane,Patrick Jane" (client 15-10-2026). Keep one value:
  // the panel broker's name, else the enquiry's broker, else the free text.
  if (Array.isArray(app.broker_name)) {
    const [txt, master] = app.broker_name;
    app.broker_name = master || app.enquiry_broker_name || txt || null;
  } else if (!app.broker_name && app.enquiry_broker_name) {
    app.broker_name = app.enquiry_broker_name;
  }
  app.stage_key = stageOf(app.status_code);

  // primary applicant (+ address/employment for the Applicant tab)
  const applicants = await db.query(
    `SELECT aa.applicant_role, ap.*,
            atp.name AS applicant_type_name
       FROM application_applicants aa
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id
       LEFT JOIN applicant_types atp ON atp.applicant_type_id = ap.applicant_type_id
      WHERE aa.application_id = @p0
      ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, ap.applicant_id`,
    [id],
  );
  app.applicants = applicants;
  app.primary_applicant = applicants[0] || null;

  // Reliable display name: primary applicant (company or first+last), else the
  // enquiry-level applicant/company name, else "—". Mirrors the list fallback.
  const pa = app.primary_applicant;
  const paName = pa
    ? (pa.company_name || [pa.first_name, pa.last_name].filter(Boolean).join(' ').trim())
    : '';
  app.applicant_name = paName || app.enq_company_name || app.enq_applicant_name || '—';

  // security / property
  const sec = await db.query(
    `SELECT s.*, vt.name AS valuation_type_name
       FROM application_security s
       LEFT JOIN valuation_types vt ON vt.valuation_type_id = s.valuation_type_id
      WHERE s.application_id = @p0 AND s.flag_deleted = 0
      ORDER BY s.security_id`,
    [id],
  );
  // Client 15-10-2026: display clean-up of the security rows -
  //  * 'OTHER_SECURITY' is an internal marker in added_value, not "Added Value Since Purchase";
  //  * charge normalised to '1st' / '2nd' (older rows said '2nd legal charge');
  //  * an other security converted before charge_amount existed kept its 2nd-charge amount in
  //    outstanding_loan - show it as the charge amount instead.
  for (const r of sec) {
    const ct = String(r.charge_type || '').trim().toLowerCase();
    if (ct.startsWith('2nd')) r.charge_type = '2nd'; else if (ct.startsWith('1st')) r.charge_type = '1st';
    if (r.added_value === 'OTHER_SECURITY') {
      r.is_other_security = true;
      r.added_value = null;
      if (r.charge_type === '2nd' && r.charge_amount == null && r.outstanding_loan != null) {
        r.charge_amount = r.outstanding_loan; r.outstanding_loan = null;
      }
    }
  }
  app.security = sec[0] || null;
  app.securities = sec;
  // Client 19-10-2026: Total LTV for the Summary tab = the application's own total_ltv_pct
  // (the LTV % entered on the indicative / offer, set at convert); else the enquiry's
  // (worked out when the enquiry was added / edited); else its own figures.
  app.summary_total_ltv_pct = totalLtv(app.amount_requested, sec);
  if (app.total_ltv_pct != null) {
    app.summary_total_ltv_pct = Number(app.total_ltv_pct);
  } else if (app.enquiry_id) {
    const [eq] = await db.query('SELECT total_ltv_pct FROM enquiries WHERE enquiry_id = @p0', [app.enquiry_id]).catch(() => []);
    if (eq && eq.total_ltv_pct != null) app.summary_total_ltv_pct = Number(eq.total_ltv_pct);
  }
  // Agreed offer terms carried over on convert (fees, broker fee, drawdowns, other securities).
  try { app.agreed_terms = app.agreed_terms ? JSON.parse(app.agreed_terms) : null; } catch (_) { app.agreed_terms = null; }

  // documents
  app.documents = await db.query(
    `SELECT d.app_document_id, d.file_name, d.file_path, d.document_type_id,
            dt.name AS document_type_name, dt.category AS document_category, dt.code AS document_type_code,
            d.version, d.status, d.verified_status, d.verified_at,
            d.uploaded_by, uu.full_name AS uploaded_by_name, d.created_at
       FROM application_documents d
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
       LEFT JOIN users uu ON uu.user_id = d.uploaded_by
      WHERE d.application_id = @p0 AND d.flag_deleted = 0
      ORDER BY CASE WHEN dt.code = 'DEAL_SUMMARY' OR d.file_name LIKE 'Credit Deal Summary%' THEN 0
                    WHEN dt.code = 'SIGNED_OFFER' THEN 1 ELSE 2 END,
               d.app_document_id DESC`,
    [id],
  );

  // Client 17-10-2026: the source enquiry's documents (uploads, indicative / offer PDFs,
  // documents received by e-mail reply to an information request) stay on the enquiry -
  // they are shown read-only on the application too (download via /offer-document/:docId).
  app.enquiry_documents = app.enquiry_id ? await db.query(
    `SELECT d.enquiry_document_id, d.file_name, COALESCE(dt.name, d.type_other) AS document_type_name, d.created_at
       FROM enquiry_documents d
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE d.enquiry_id = @p0 AND d.flag_deleted = 0
      ORDER BY d.enquiry_document_id DESC`,
    [app.enquiry_id],
  ) : [];

  // tasks
  app.tasks = await db.query(
    `SELECT t.task_id, t.task_type, t.description, t.due_date, t.status, t.completed_at,
            t.assigned_to, u.full_name AS assigned_to_name
       FROM application_tasks t
       LEFT JOIN users u ON u.user_id = t.assigned_to
      WHERE t.application_id = @p0 AND t.flag_deleted = 0
      ORDER BY CASE WHEN t.status = 'Outstanding' THEN 0 ELSE 1 END, t.due_date`,
    [id],
  );

  // communications
  app.communications = await db.query(
    `SELECT c.communication_id, c.channel, c.to_party, c.subject, c.body, c.comm_at,
            c.from_user_id, u.full_name AS from_user_name
       FROM application_communications c
       LEFT JOIN users u ON u.user_id = c.from_user_id
      WHERE c.application_id = @p0 AND c.flag_deleted = 0
      ORDER BY c.comm_at DESC`,
    [id],
  );

  // notes (Applicant tab: Recent Notes)
  app.notes = await listNotes(id);

  // #B4: the originating enquiry's notes / communications, shown in the
  // application Communications tab alongside the application's own.
  app.enquiry_communications = app.enquiry_id ? await db.query(
    `SELECT n.note_id, n.note, n.created_by, u.full_name AS created_by_name, n.created_at
       FROM enquiry_notes n LEFT JOIN users u ON u.user_id = n.created_by
      WHERE n.enquiry_id = @p0 ORDER BY n.created_at DESC`, [app.enquiry_id]) : [];

  // Initial Offer tab: the enquiry's indicative + offer history (read-only mirror).
  if (app.enquiry_id) {
    const offs = await db.query(
      `SELECT enquiry_offer_id, version_no, status, offer_pdf_doc_id, app_form_doc_id,
              valid_until, sent_at, accepted_at, created_at, offer_json
         FROM enquiry_offers WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [app.enquiry_id]);
    app.offers = offs.map((o) => {
      let j = {}; try { j = o.offer_json ? JSON.parse(o.offer_json) : {}; } catch (e) { j = {}; }
      return {
        enquiry_offer_id: o.enquiry_offer_id, version_no: o.version_no, status: o.status,
        offer_pdf_doc_id: o.offer_pdf_doc_id, app_form_doc_id: o.app_form_doc_id,
        valid_until: o.valid_until, sent_at: o.sent_at, accepted_at: o.accepted_at, created_at: o.created_at,
        gross_loan_amount: j.gross_loan_amount != null ? Number(j.gross_loan_amount) : null,
        monthly_rate_pct: j.monthly_rate_pct != null ? Number(j.monthly_rate_pct) : null,
        indicative_id: j.indicative_id != null ? Number(j.indicative_id) : null,
        offer_notes: j.offer_notes || null,
      };
    });
    app.indicatives = await db.query(
      `SELECT enquiry_indicative_id, version_no, status, document_id, sent_at, created_at
         FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [app.enquiry_id]);
  } else { app.offers = []; app.indicatives = []; }

  // audit trail
  // The whole case history, not just this record's: the originating enquiry,
  // this application, and its underwriting case all belong to one story.
  app.audit = await (async () => {
    const chain = [{ entity: 'applications', id, module: 'Application' }];
    if (app.enquiry_id) chain.push({ entity: 'enquiries', id: app.enquiry_id, module: 'Enquiry' });
    const logs = await audit.listForChain(chain);
    const uw = app.underwriting_case_id
      ? await enquirySvcTrail(app.underwriting_case_id).catch(() => [])
      : [];
    return audit.mergeTrails(logs, uw).map((r) => ({ ...r, timestamp: r.created_at }));
  })().catch(() => []);

  // enquiry link (Enquiry Details tab)
  if (app.enquiry_id) {
    const enq = await db.query(
      `SELECT e.enquiry_id, e.enquiry_ref, e.applicant_name, e.company_name, e.email, e.phone,
              e.dob, e.company_reg_no, e.amount_requested, e.loan_basis, e.term_months, e.property_address,
              e.estimated_value, e.summary, e.lead_source, e.requested_completion_date,
              e.postcode, e.property_type, e.tenure, e.tenure_years, e.charge_type, e.gdv,
              e.owns_property, e.purchase_price, e.purchase_date, e.outstanding_loan,
              e.repaid_on_completion, e.lender, e.added_value, e.ltv_pct,
              e.created_at, e.converted_at,
              e.interest_type, e.drawdowns_required, e.total_project_cost, e.own_contribution,
              e.deposit_source, e.additional_borrowing,
              e.rep_type, e.borrower_sol_firm, e.borrower_sol_contact, e.borrower_sol_address,
              e.borrower_sol_telephone, e.borrower_sol_email,
              e.deal_appraisal, e.exit_strategy, e.risk_mitigants, e.credit_recommendation,
              lp.name AS purpose_name, src.name AS source_name, br.name AS broker_name,
              b.branch_name, u.full_name AS bdm_name, p.name AS product_name
         FROM enquiries e
         LEFT JOIN loan_purposes lp ON lp.loan_purpose_id = e.loan_purpose_id
         LEFT JOIN application_sources src ON src.application_source_id = e.application_source_id
         LEFT JOIN brokers br ON br.broker_id = e.broker_id
         LEFT JOIN branches b ON b.branch_id = e.branch_id
         LEFT JOIN products p ON p.product_id = e.product_id
         LEFT JOIN users u ON u.user_id = e.assigned_to
        WHERE e.enquiry_id = @p0`,
      [app.enquiry_id],
    );
    app.enquiry = enq[0] || null;
    if (app.enquiry) {
      app.enquiry.applicants = await db.query(
        `SELECT enquiry_applicant_id, sort_order, is_primary, full_name, dob, nationality,
                address, time_at_address, email, mobile, owns_home, occupation, employer_name,
                business_address, length_of_service, relationship, shareholding_pct,
                prev_bridging, prev_bridging_lender
           FROM enquiry_applicants
          WHERE enquiry_id = @p0 AND flag_deleted = 0
          ORDER BY is_primary DESC, sort_order, enquiry_applicant_id`,
        [app.enquiry_id],
      ).catch(() => []);
      app.enquiry.notes = await db.query(
        `SELECT n.note_id, n.note, u.full_name AS created_by_name, n.created_at
           FROM enquiry_notes n LEFT JOIN users u ON u.user_id = n.created_by
          WHERE n.enquiry_id = @p0 ORDER BY n.created_at DESC`,
        [app.enquiry_id],
      );
    }
  } else {
    app.enquiry = null;
  }

  return app;
}

async function listNotes(id) {
  return db.query(
    `SELECT n.note_id, n.note, n.created_by, u.full_name AS created_by_name, n.created_at
       FROM application_notes n LEFT JOIN users u ON u.user_id = n.created_by
      WHERE n.application_id = @p0 ORDER BY n.created_at DESC`,
    [id],
  );
}

/* ------------------------------------------------------------------ */
/*  UPDATE / STATUS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Manual create (POST /). Full origination: validates required fields, inserts
 * the applicant, the application (status DRAFT), the applicant link, the
 * security/property row, computed pricing (net advance, fees, IRR, LTV) and a
 * starting KYC state — all so a manually-added application looks and behaves
 * exactly like a converted one.
 */
async function create(body, req) {
  body = body || {};
  const errors = {};
  const name = String(body.applicant_name || '').trim();
  const company = String(body.company_name || '').trim();
  const { classifyApplicantType } = require('../utils/applicant-type');
  const isCompany = classifyApplicantType(body.applicant_type_code || body.applicant_type_name).isCompany || (!!company && !name);
  if (!name && !company) errors.applicant_name = 'Applicant name is required';
  if (body.dob && String(body.dob).slice(0, 10) > new Date().toISOString().slice(0, 10)) errors.dob = 'Date of birth cannot be later than today';

  const email = String(body.email || '').trim();
  if (email && !RX.email.test(email)) errors.email = 'Enter a valid email address';
  const phone = String(body.phone || '').trim();
  if (phone && !RX.phone.test(phone)) errors.phone = 'Enter a valid phone number';

  const amount = Number(body.amount_requested);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount_requested = 'Enter a valid gross loan amount';
  const term = parseInt(body.term_months, 10);
  if (!Number.isFinite(term) || term <= 0) errors.term_months = 'Enter a valid term in months';

  if (!int(body.product_id)) errors.product_id = 'Select a product';
  if (!int(body.branch_id)) errors.branch_id = 'Select a branch';

  const secAddr = String(body.property_address || '').trim();
  const estVal = Number(body.estimated_value);
  if (!secAddr) errors.property_address = 'Security address is required';
  if (!Number.isFinite(estVal) || estVal <= 0) errors.estimated_value = 'Enter a valid estimated value';

  if (Object.keys(errors).length) return { ok: false, errors };

  // ---- pricing (mirror the front-end review preview) ----
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const monthly = num(body.monthly_fee_pct);
  const arrPct = num(body.arrangement_fee_pct);
  const exitPct = num(body.exit_fee_pct);
  const docFee = num(body.doc_fee);
  const loandeskPct = num(body.loandesk_broker_fee_pct);
  const brokerPct = num(body.borrower_broker_fee_pct);
  const arrangement = Math.round(amount * arrPct) / 100;
  const exitFee = Math.round(amount * exitPct) / 100;
  const rolled = Math.round(amount * monthly * term) / 100;
  const borrowerBrokerFee = Math.round(amount * brokerPct) / 100;
  const netAdvance = Math.round((amount - arrangement - docFee - rolled) * 100) / 100;
  const grossRedemption = Math.round((amount + exitFee) * 100) / 100;
  const lenderIncome = Math.round((arrangement + exitFee + docFee + rolled) * 100) / 100;
  // ltv_pct is DECIMAL(6,3) (max 999.999) — clamp so a tiny security value
  // (loan > ~10x value) doesn't overflow the column.
  let ltv = estVal > 0 ? Math.round((amount / estVal) * 10000) / 100 : null;
  if (ltv != null && ltv > 999.999) ltv = 999.999;
  const irr = Math.round(monthly * 12 * 100) / 100;
  const uid = req && req.userData ? req.userData.userId : null;

  const ref = await generateRef();
  const draftStatusId = await statusIdOf('DRAFT');

  // application row
  const out = await db.query(
    `INSERT INTO applications
       (application_ref, branch_id, product_id, loan_purpose_id, application_status_id,
        application_source_id, broker_id, amount_requested, term_months, assigned_to,
        underwriter_id, credit_manager_id, completion_date,
        net_advance, ltv_pct, monthly_fee_pct, arrangement_fee_pct, exit_fee, doc_fee,
        rolled_interest, gross_redemption, irr_pct, loandesk_broker_fee_pct, borrower_broker_fee, lender_income,
        kyc_identity_status, kyc_aml_status, kyc_pep_status, kyc_overall_status, created_by)
     OUTPUT INSERTED.application_id AS id
     VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p16,@p17,@p18,@p19,@p20,@p21,@p22,@p23,@p24,@p25,@p26,@p27,@p28,@p29)`,
    [
      ref, int(body.branch_id), int(body.product_id), int(body.loan_purpose_id), draftStatusId,
      int(body.application_source_id), int(body.broker_id), amount, term, int(body.assigned_to) || uid,
      int(body.underwriter_id), int(body.credit_manager_id), body.completion_date ? String(body.completion_date).slice(0,10) : null,
      netAdvance, ltv, monthly, arrPct, exitFee, docFee,
      rolled, grossRedemption, irr, loandeskPct, borrowerBrokerFee, lenderIncome,
      body.kyc_identity_status || 'Pending', body.kyc_aml_status || 'Pending',
      body.kyc_pep_status || 'Pending', body.kyc_overall_status || 'Pending', uid,
    ],
  );
  const applicationId = out[0].id;

  // applicant + link
  const sp = name.indexOf(' ');
  const firstName = isCompany ? null : (sp > 0 ? name.slice(0, sp) : name || null);
  const lastName = isCompany ? null : (sp > 0 ? name.slice(sp + 1) : null);
  const ap = await db.query(
    `INSERT INTO applicants (applicant_type_id, first_name, last_name, company_name, email, phone, dob, created_by)
     OUTPUT INSERTED.applicant_id AS id VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7)`,
    [int(body.applicant_type_id), firstName, lastName, isCompany ? (company || name) : (company || null),
     email || null, phone || null, body.dob ? String(body.dob).slice(0,10) : null, uid],
  );
  await db.query(
    `INSERT INTO application_applicants (application_id, applicant_id, applicant_role) VALUES (@p0,@p1,'Primary')`,
    [applicationId, ap[0].id],
  );

  // optional personal guarantor (Figma: "Add Personal Guarantor" checkbox + name)
  const gName = String(body.guarantor_name || '').trim();
  if (gName) {
    const gsp = gName.indexOf(' ');
    const gAp = await db.query(
      `INSERT INTO applicants (first_name, last_name, created_by) OUTPUT INSERTED.applicant_id AS id VALUES (@p0,@p1,@p2)`,
      [gsp > 0 ? gName.slice(0, gsp) : gName, gsp > 0 ? gName.slice(gsp + 1) : null, uid],
    );
    await db.query(
      `INSERT INTO application_applicants (application_id, applicant_id, applicant_role) VALUES (@p0,@p1,'Guarantor')`,
      [applicationId, gAp[0].id],
    );
  }

  // security
  await db.query(
    `INSERT INTO application_security (application_id, property_address, estimated_value, charge_type, created_by)
     VALUES (@p0,@p1,@p2,@p3,@p4)`,
    [applicationId, secAddr, estVal, body.charge_type || '1st Legal Charge', uid],
  );

  // financial information (application_financials)
  const fin = body.financial || {};
  const fincome = num(fin.income), fworth = num(fin.net_worth), fliab = num(fin.liabilities);
  if (fincome || fworth || fliab) {
    await db.query(
      `INSERT INTO application_financials (application_id, total_income, total_assets, total_liabilities, ltv_pct, created_by)
       VALUES (@p0,@p1,@p2,@p3,@p4,@p5)`,
      [applicationId, fincome || null, fworth || null, fliab || null, ltv, uid],
    );
  }

  // documents CHECKLIST is a requirements tracker, NOT uploaded files — do not
  // create document rows (they would show as fileless rows with dead Preview/
  // Download). Record which were marked received in the opening note instead.
  const receivedDocs = Array.isArray(body.documents)
    ? body.documents.filter((d) => d && d.received).map((d) => String(d.name)).filter(Boolean)
    : [];

  // capture exit strategy / source of funds / credit score + received docs as an opening note
  const extras = [];
  if (receivedDocs.length) extras.push('Documents received: ' + receivedDocs.join(', '));
  if (body.exit_strategy) extras.push('Exit strategy: ' + String(body.exit_strategy));
  if (body.source_of_funds) extras.push('Source of funds: ' + String(body.source_of_funds));
  if (body.credit_score) extras.push('Credit score: ' + String(body.credit_score));
  if (extras.length) {
    await db.query(
      `INSERT INTO application_notes (application_id, note, created_by) VALUES (@p0,@p1,@p2)`,
      [applicationId, extras.join(' · '), uid],
    );
  }

  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_CREATE', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: applicationId,
    details: { ref, source: 'manual' },
  }));
  return { ok: true, id: applicationId, application_ref: ref };
}

/**
 * Write the borrower block to the application's PRIMARY applicant row,
 * creating one if the application has none yet. Returns the changed keys.
 */
async function saveApplicantBlock(appId, body, req) {
  const single = {};
  // One "Applicant Name" box on screen, two columns underneath.
  if (Object.prototype.hasOwnProperty.call(body, 'applicant_name')) {
    const parts = String(body.applicant_name || '').trim().split(/\s+/);
    single.first_name = parts.shift() || null;
    single.last_name = parts.length ? parts.join(' ') : null;
  }
  const { ok, errors, values } = validate({ ...body, ...single }, { partial: true, fields: CFG.APPLICANT_FIELDS });
  if (!ok) return { ok: false, errors };
  const keys = Object.keys(values);
  if (!keys.length) return { ok: true, keys: [] };

  let rows = await db.query(
    `SELECT TOP 1 ap.applicant_id AS id
       FROM applicants ap
       JOIN application_applicants aa ON aa.applicant_id = ap.applicant_id
      WHERE aa.application_id = @p0 AND aa.applicant_role = 'Primary'`, [appId]);
  let applicantId = rows.length ? rows[0].id : null;

  if (!applicantId) {
    const ins = await db.query(
      `INSERT INTO applicants (created_by) OUTPUT INSERTED.applicant_id AS id VALUES (@p0)`, [actorId(req)]);
    applicantId = ins[0].id;
    await db.query(
      `INSERT INTO application_applicants (application_id, applicant_id, applicant_role, created_by)
       VALUES (@p0, @p1, 'Primary', @p2)`, [appId, applicantId, actorId(req)]);
  }

  const setSql = keys.map((c, i) => `${c} = @p${i}`).join(', ');
  const params = keys.map((c) => values[c]);
  params.push(actorId(req), applicantId);
  await db.query(
    `UPDATE applicants SET ${setSql}, updated_by = @p${keys.length}, updated_at = SYSUTCDATETIME()
      WHERE applicant_id = @p${keys.length + 1}`, params);
  return { ok: true, keys };
}

/** Write the property / security block, creating the row if absent. */
async function saveSecurityBlock(appId, body, req) {
  const { ok, errors, values } = validate(body, { partial: true, fields: CFG.SECURITY_FIELDS });
  if (!ok) return { ok: false, errors };
  const keys = Object.keys(values);
  if (!keys.length) return { ok: true, keys: [] };

  const rows = await db.query('SELECT TOP 1 security_id AS id FROM application_security WHERE application_id = @p0', [appId]);
  if (!rows.length) {
    await db.query('INSERT INTO application_security (application_id, created_by) VALUES (@p0, @p1)', [appId, actorId(req)]);
  }
  const setSql = keys.map((c, i) => `${c} = @p${i}`).join(', ');
  const params = keys.map((c) => values[c]);
  params.push(actorId(req), appId);
  await db.query(
    // MAIN security only - the old WHERE application_id also overwrote every other security.
    `UPDATE application_security SET ${setSql}, updated_by = @p${keys.length}, updated_at = SYSUTCDATETIME()
      WHERE security_id = (SELECT TOP 1 security_id FROM application_security
                            WHERE application_id = @p${keys.length + 1} AND flag_deleted = 0 ORDER BY security_id)`, params);
  return { ok: true, keys };
}

async function update(id, body, req) {
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { ok: false, notFound: true };

  const { ok, errors, values } = validate(body, { partial: true });
  if (!ok) return { ok: false, errors };

  // The borrower and property blocks live on their own tables. Validate both
  // BEFORE writing anything, so a bad postcode cannot leave the applications
  // row updated and the security row untouched.
  const applicant = await saveApplicantBlock(id, body, req);
  if (!applicant.ok) return { ok: false, errors: applicant.errors };
  const security = await saveSecurityBlock(id, body, req);
  if (!security.ok) return { ok: false, errors: security.errors };

  const keys = Object.keys(values);
  if (!keys.length) {
    if (applicant.keys.length || security.keys.length) {
      await audit.write(audit.fromReq(req, {
        action: 'APPLICATION_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
        details: { fields: [...applicant.keys, ...security.keys] },
      }));
    }
    return { ok: true, id };
  }

  const setSql = keys.map((c, i) => `${c} = @p${i}`).join(', ');
  const params = keys.map((c) => values[c]);
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(id);
  await db.query(
    `UPDATE applications SET ${setSql}, updated_by = @p${keys.length}, updated_at = SYSUTCDATETIME()
      WHERE application_id = @p${keys.length + 1}`,
    params,
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
    details: { fields: [...keys, ...applicant.keys, ...security.keys] },
  }));
  return { ok: true, id };
}

/** Resolve a status id from its code (cached-free, small master). */
async function statusIdOf(code) {
  const rows = await db.query(
    `SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code = @p0 AND flag_deleted = 0`,
    [String(code).toUpperCase()],
  );
  return rows.length ? rows[0].id : null;
}

async function changeStatus(id, toCode, req, reason) {
  const cur = await db.query(
    `SELECT a.application_status_id, st.code AS status_code
       FROM applications a LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
      WHERE a.application_id = @p0 AND a.flag_deleted = 0`,
    [id],
  );
  if (!cur.length) return { ok: false, error: 'Application not found' };
  const fromCode = String(cur[0].status_code || '').toUpperCase();
  const target = String(toCode || '').toUpperCase();

  const force = !!(req && req.userData && req.userData.isSuperAdmin);
  // Client 05-10-2026: once an application has entered UNDERWRITING it cannot be reverted
  // back to Submitted / BDM from the application screen. The underwriter's own
  // "Return to BDM" (a separate path that writes the status directly) is the only way back.
  if (fromCode === 'UNDERWRITING' && (target === 'SUBMITTED' || target === 'DRAFT')) {
    return { ok: false, error: 'This application is in underwriting and cannot be reverted. Use "Return to BDM" from the underwriting screen if it needs to go back.' };
  }
  const allowed = CFG.TRANSITIONS[fromCode] || [];
  if (!force && fromCode !== target && !allowed.includes(target)) {
    return { ok: false, error: `Cannot move from ${fromCode || 'current status'} to ${target}` };
  }
  const toId = await statusIdOf(target);
  if (!toId) return { ok: false, error: 'Unknown target status' };

  await db.query(
    `UPDATE applications SET application_status_id = @p1,
        submitted_at = ${target === 'SUBMITTED' ? 'COALESCE(submitted_at, SYSUTCDATETIME())' : 'submitted_at'},
        updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE application_id = @p0`,
    [id, toId, req && req.userData ? req.userData.userId : null],
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_STATUS_CHANGE', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
    details: { from: fromCode, to: target, reason: reason || null },
  }));
  // Client 05-10-2026 (#16): on a backward move keep the underwriting case in step with
  // the application so a returned case never lingers in the wrong queue.
  const uid = req && req.userData ? req.userData.userId : null;
  try {
    if (target === 'DRAFT') {
      // Returned to the BDM — take the case out of underwriting entirely (any source stage,
      // including a case created at SUBMITTED that never reached underwriting).
      await db.query(
        `UPDATE underwriting_cases
            SET status = 'Closed', closed_reason = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
          WHERE application_id = @p0 AND flag_deleted = 0
            AND status NOT IN ('In Portfolio', 'Rejected', 'Closed')`,
        [id, reason || 'Application returned to BDM', uid]);
    } else if (fromCode === 'UNDERWRITING' && target === 'SUBMITTED') {
      // Reverted the acceptance — close the active case. It reopens (to New Review) only
      // when the application is sent to underwriting again.
      await db.query(
        `UPDATE underwriting_cases
            SET status = 'Closed', closed_reason = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
          WHERE application_id = @p0 AND flag_deleted = 0
            AND status NOT IN ('In Portfolio', 'Rejected', 'Closed')`,
        [id, reason || 'Acceptance reverted', uid]);
    } else if (fromCode === 'CREDIT_REVIEW' && target === 'UNDERWRITING') {
      // Reverted from Credit back to Underwriting — reopen the case for the underwriter.
      await db.query(
        `UPDATE underwriting_cases
            SET status = 'In Progress', updated_by = @p1, updated_at = SYSUTCDATETIME()
          WHERE application_id = @p0 AND flag_deleted = 0 AND status = 'Sent to Credit'`,
        [id, uid]);
    }
  } catch (e) { /* best-effort: never block the status change */ }
  // Client 05-10-2026 (#5): the underwriting case is opened ONLY when the application is
  // actually sent to underwriting (target UNDERWRITING), NOT when it is accepted/submitted.
  // Before this, accepting in Application Detail created the case straight away, so it
  // showed in the Underwriting listing before "Send to Underwriting" was ever clicked.
  // Best-effort: never block the status change.
  if (target === 'UNDERWRITING') {
    try { await underwriting.ensureCase(id, req); } catch (e) { /* best-effort */ }
  }
  return { ok: true, id, from: fromCode, to: target };
}

/* ------------------------------------------------------------------ */
/*  TASKS                                                              */
/* ------------------------------------------------------------------ */

async function addTask(id, body, req) {
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { notFound: true };
  const desc = String(body.description || '').trim();
  if (!desc) return { ok: false, errors: { description: 'Description is required' } };
  const out = await db.query(
    `INSERT INTO application_tasks (application_id, task_type, description, due_date, assigned_to, status, created_by)
     OUTPUT INSERTED.task_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)`,
    [
      id, body.task_type ? String(body.task_type).slice(0, 60) : null, desc.slice(0, 500),
      body.due_date ? String(body.due_date).slice(0, 10) : null, int(body.assigned_to),
      body.status ? String(body.status).slice(0, 30) : 'Outstanding',
      req && req.userData ? req.userData.userId : null,
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_TASK_ADD', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
  }));
  return { ok: true, id: out[0].id };
}

async function updateTask(id, taskId, body, req) {
  const rows = await db.query(
    'SELECT 1 FROM application_tasks WHERE task_id = @p0 AND application_id = @p1 AND flag_deleted = 0', [taskId, id]);
  if (!rows.length) return { notFound: true };
  const sets = [];
  const params = [];
  let i = 0;
  const add = (col, val) => { sets.push(`${col} = @p${i}`); params.push(val); i += 1; };
  if (body.status !== undefined) {
    add('status', String(body.status).slice(0, 30));
    if (String(body.status) === 'Completed') add('completed_at', new Date().toISOString());
  }
  if (body.description !== undefined) add('description', String(body.description).slice(0, 500));
  if (body.due_date !== undefined) add('due_date', body.due_date ? String(body.due_date).slice(0, 10) : null);
  if (body.assigned_to !== undefined) add('assigned_to', int(body.assigned_to));
  if (!sets.length) return { ok: true };
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(taskId);
  await db.query(
    `UPDATE application_tasks SET ${sets.join(', ')}, updated_by = @p${i}, updated_at = SYSUTCDATETIME()
      WHERE task_id = @p${i + 1}`,
    params,
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  COMMUNICATIONS                                                     */
/* ------------------------------------------------------------------ */

async function addCommunication(id, body, req) {
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { notFound: true };
  const subject = String(body.subject || '').trim();
  const bodyTxt = body.body != null ? String(body.body).trim() : '';
  // Client 06-10-2026: the application Communications tab now uses the same single
  // free-text box as the enquiry page, so a subject is no longer required - a note
  // (body) on its own is a valid communication.
  if (!subject && !bodyTxt) return { ok: false, errors: { body: 'Enter a note' } };
  const out = await db.query(
    `INSERT INTO application_communications (application_id, from_user_id, to_party, channel, subject, body, comm_at, created_by)
     OUTPUT INSERTED.communication_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, SYSUTCDATETIME(), @p6)`,
    [
      id, req && req.userData ? req.userData.userId : null,
      body.to_party ? String(body.to_party).slice(0, 200) : null,
      body.channel ? String(body.channel).slice(0, 30) : 'Note',
      subject.slice(0, 300), body.body != null ? String(body.body) : null,
      req && req.userData ? req.userData.userId : null,
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_COMM_ADD', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
  }));
  return { ok: true, id: out[0].id };
}

/* ------------------------------------------------------------------ */
/*  NOTES                                                              */
/* ------------------------------------------------------------------ */

async function requestInfo(id, body, req) {
  const rows = await db.query(
    `SELECT a.application_id, a.application_ref, a.enquiry_id,
            COALESCE(a.broker_id, e.broker_id) AS broker_id,
            COALESCE(NULLIF(br.company,''), br.name, NULLIF(ebr.company,''), ebr.name) AS broker_name,
            COALESCE(br.email, ebr.email) AS broker_email,
            bdm.full_name AS bdm_name, bdm.email AS bdm_email,
            ap.first_name, ap.last_name, ap.company_name, ap.email AS applicant_email,
            e.property_address AS enquiry_property_address
       FROM applications a
       LEFT JOIN brokers br ON br.broker_id = a.broker_id
       LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
       LEFT JOIN brokers ebr ON ebr.broker_id = e.broker_id
       LEFT JOIN users bdm ON bdm.user_id = a.assigned_to
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
      WHERE a.application_id = @p0 AND a.flag_deleted = 0`, [id]);
  if (!rows.length) return { notFound: true };
  const a = rows[0];

  const sendTo = String((body && body.send_to) || '').trim();
  const items = Array.isArray(body && body.items) ? body.items.map((x) => String(x)).filter(Boolean) : [];
  const comments = body && body.comments ? String(body.comments).trim() : '';
  const dueDate = body && body.due_date ? String(body.due_date).slice(0, 10) : '';

  const borrower = a.company_name || [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || 'the applicant';
  const ref = a.application_ref || ('APP-' + a.application_id);

  const targets = {
    'BDM / Sales': { email: a.bdm_email, name: a.bdm_name || 'BDM' },
    Broker: { email: a.broker_email, name: a.broker_name || 'Broker' },
    Applicant: { email: a.applicant_email, name: borrower },
  };
  const target = targets[sendTo];
  if (!target) return { ok: false, error: 'Choose who to send the request to', errors: { send_to: 'Choose who to send the request to' } };
  if (!target.email || !String(target.email).includes('@')) {
    return { ok: false, error: `No email address on file for the ${sendTo}`, errors: { send_to: `No email address on file for the ${sendTo}` } };
  }

  // Every security property on the application (both / all), de-duplicated.
  const secRows = await db.query(
    `SELECT property_address FROM application_security
      WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id`, [id]);
  const addrs = [];
  const seen = new Set();
  const pushAddr = (v) => {
    const t = String(v == null ? '' : v).trim();
    if (!t) return; const k = t.toUpperCase().replace(/\s/g, '');
    if (seen.has(k)) return; seen.add(k); addrs.push(t);
  };
  secRows.forEach((r) => pushAddr(r.property_address));
  if (!addrs.length) pushAddr(a.enquiry_property_address);

  const esc = (t) => String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const secHtml = addrs.length > 1
    ? `<p><strong>Security addresses:</strong></p><ul>${addrs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
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
  const { subject: mailSubject, html } = emailHub.render('APPLICATION_INFO_REQUEST', mailVars);

  // cc the BDM whenever the request is NOT addressed to the BDM (client 09-10-2026:
  // a request to the broker always copies the BDM in).
  const ccList = (a.bdm_email && String(a.bdm_email).toLowerCase() !== String(target.email || '').toLowerCase())
    ? [a.bdm_email] : [];

  const sent = await mail.sendMail({
    to: target.email,
    cc: ccList,
    subject: mailSubject,
    html,
    // Email Settings master + Email History (client 17-10-2026)
    event: 'APPLICATION_INFO_REQUEST', ref: { module: 'APPLICATION', id, number: ref }, req, vars: mailVars,
  });
  const ok = !!(sent && sent.ok !== false);

  // Keep a note on the application (mirrors the previous behaviour) + audit.
  const noteParts = [`Information requested from ${sendTo} (${target.email})${ccList.length ? ' — cc BDM ' + ccList[0] : ''}`];
  if (items.length) noteParts.push('Items: ' + items.join(', '));
  if (dueDate) noteParts.push('Due ' + dueDate);
  if (comments) noteParts.push(comments);
  if (!ok) noteParts.push('EMAIL FAILED: ' + (sent && sent.error || 'unknown error'));
  await db.query(
    `INSERT INTO application_notes (application_id, note, created_by) VALUES (@p0, @p1, @p2)`,
    [id, noteParts.join('. ').slice(0, 4000), req && req.userData ? req.userData.userId : null]).catch(() => {});

  await audit.write(audit.fromReq(req, {
    action: ok ? 'INFO_REQUEST_EMAILED' : 'INFO_REQUEST_EMAIL_FAILED',
    moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
    details: { send_to: sendTo, to: target.email, cc: ccList, items, due_date: dueDate || null, error: ok ? null : (sent && sent.error) },
  })).catch(() => {});

  return ok
    ? { ok: true, sent_to: target.email, cc: ccList, recipient: sendTo }
    : { ok: false, error: `Could not email the ${sendTo}: ${(sent && sent.error) || 'send failed'}` };
}

async function addNote(id, note, req) {
  const text = String(note || '').trim();
  if (!text) return { ok: false, errors: { note: 'Note text is required' } };
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { notFound: true };
  const out = await db.query(
    `INSERT INTO application_notes (application_id, note, created_by) OUTPUT INSERTED.note_id AS id VALUES (@p0, @p1, @p2)`,
    [id, text.slice(0, 4000), req && req.userData ? req.userData.userId : null],
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_NOTE_ADD', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
  }));
  return { ok: true, id: out[0].id };
}

/* ------------------------------------------------------------------ */
/*  DOCUMENTS                                                          */
/* ------------------------------------------------------------------ */

const DOC_DIR = path.join('uploads', 'application_documents');

async function addDocument(id, body, req) {
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { notFound: true };
  const name = String(body.file_name || '').trim();
  const b64 = String(body.content_base64 || '');
  if (!name || !b64) return { ok: false, errors: { file: 'file_name and content_base64 are required' } };
  const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  // Tester 20-10-2026: size / type / real-content check on the API, sanitised name.
  const chk = fileGuard.checkUpload(name, buf);
  if (!chk.ok) return { ok: false, errors: { file: chk.error } };
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = fileGuard.diskName(chk.name);
  fs.writeFileSync(path.join(absDir, safe), buf);
  const rel = path.join(DOC_DIR, safe);
  const out = await db.query(
    `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
     OUTPUT INSERTED.app_document_id AS id
     VALUES (@p0, @p1, @p2, @p3, 'Uploaded', 'v1', @p4, @p4)`,
    [id, int(body.document_type_id), chk.name, rel, req && req.userData ? req.userData.userId : null],
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_DOC_UPLOAD', moduleKey: CFG.MODULE_KEY, entityName: 'applications', entityId: id,
  }));
  return { ok: true, id: out[0].id };
}

async function getDocument(id, docId) {
  const rows = await db.query(
    `SELECT file_name, file_path FROM application_documents
      WHERE app_document_id = @p0 AND application_id = @p1 AND flag_deleted = 0`,
    [docId, id],
  );
  return rows[0] || null;
}

async function updateDocument(id, docId, body, req) {
  const rows = await db.query(
    'SELECT version FROM application_documents WHERE app_document_id = @p0 AND application_id = @p1 AND flag_deleted = 0', [docId, id]);
  if (!rows.length) return { notFound: true };
  const sets = [];
  const params = [];
  let i = 0;
  const add = (col, val) => { sets.push(`${col} = @p${i}`); params.push(val); i += 1; };

  // optional file replacement (bumps the version, e.g. v1 -> v2)
  const name = String(body.file_name || '').trim();
  const b64 = String(body.content_base64 || '');
  if (name && b64) {
    const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const chk = fileGuard.checkUpload(name, buf);
    if (!chk.ok) return { ok: false, errors: { file: chk.error } };
    const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
    if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
    const safe = fileGuard.diskName(chk.name);
    fs.writeFileSync(path.join(absDir, safe), buf);
    add('file_name', chk.name);
    add('file_path', path.join(DOC_DIR, safe));
    const cur = String((rows[0] && rows[0].version) || 'v1').replace(/[^0-9]/g, '');
    const nextV = 'v' + ((parseInt(cur, 10) || 1) + 1);
    add('version', nextV);
  }

  if (body.status !== undefined) add('status', String(body.status).slice(0, 30));
  if (body.verified_status !== undefined) {
    add('verified_status', String(body.verified_status).slice(0, 30));
    add('verified_at', new Date().toISOString().slice(0, 10));
  }
  if (body.document_type_id !== undefined) add('document_type_id', int(body.document_type_id));
  if (!sets.length) return { ok: true };
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(docId);
  await db.query(
    `UPDATE application_documents SET ${sets.join(', ')}, updated_by = @p${i}, updated_at = SYSUTCDATETIME()
      WHERE app_document_id = @p${i + 1}`,
    params,
  );
  return { ok: true };
}

async function deleteDocument(id, docId, req) {
  await db.query(
    `UPDATE application_documents SET flag_deleted = 1, updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE app_document_id = @p0 AND application_id = @p1 AND flag_deleted = 0`,
    [docId, id, req && req.userData ? req.userData.userId : null],
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  COUNTS + FORM OPTIONS                                              */
/* ------------------------------------------------------------------ */

/** Per-stage counts for the listing filter chips (global, not search-filtered). */
async function stageCounts(opts = {}) {
  const scoped = opts.scopeUserId !== undefined && opts.scopeUserId !== null;
  // "My deals" toggle: counts follow the list so chip numbers match the table.
  const me = opts.mine ? int(opts.currentUserId) : 0;
  const p = {};
  if (scoped) p.scope_uid = int(opts.scopeUserId, 0);
  if (me) p.me = me;
  const rows = await db.queryNamed(
    `SELECT st.code AS code, COUNT(*) AS n
       FROM applications a
       LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
      WHERE a.flag_deleted = 0${scoped ? scopeWhere('scope_uid') : ''}${me ? ' AND a.assigned_to = @me' : ''}
      GROUP BY st.code`,
    p,
  );
  const byStage = {};
  let total = 0;
  for (const r of rows) {
    const stage = stageOf(r.code);
    byStage[stage] = (byStage[stage] || 0) + r.n;
    total += r.n;
  }
  return { total, byStage };
}

async function formOptions() {
  const [branches, products, purposes, sources, brokers, applicantTypes, rejectionReasons, statuses, bdms, underwriters, documentTypes, valuationTypes] = await Promise.all([
    db.query(`SELECT branch_id AS id, branch_name AS name FROM branches WHERE flag_deleted = 0 AND is_active = 1 ORDER BY branch_name`),
    db.query(`SELECT product_id AS id, name FROM products WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT loan_purpose_id AS id, name FROM loan_purposes WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT application_source_id AS id, name FROM application_sources WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT broker_id AS id, name FROM brokers WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT applicant_type_id AS id, code, name FROM applicant_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT rejection_reason_id AS id, code, name FROM rejection_reasons WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT application_status_id AS id, code, name FROM application_statuses WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order`),
    db.query(`SELECT user_id AS id, full_name AS name FROM users WHERE flag_deleted = 0 AND is_active = 1 ORDER BY full_name`),
    db.query(`SELECT user_id AS id, full_name AS name FROM users WHERE flag_deleted = 0 AND is_active = 1 ORDER BY full_name`),
    db.query(`SELECT document_type_id AS id, name, category FROM document_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT valuation_type_id AS id, name FROM valuation_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
  ]);
  return { branches, products, purposes, sources, brokers, applicantTypes, rejectionReasons, statuses, bdms, underwriters, documentTypes, valuationTypes };
}


/* ------------------------------------------------------------------ */
/*  APPLICANT (primary) + SECURITY tab field edits                    */
/* ------------------------------------------------------------------ */

/** Small typed setter builder for a partial UPDATE. Returns {sets, params}. */
/**
 * Build an UPDATE set-list from a whitelist spec: [column, type, maxLength].
 *
 * The third element is the column's REAL NVARCHAR width. Previously every text
 * value was sliced to a blanket 255 — which silently truncated anything in a
 * narrower column and still burst the narrowest ones. A 52-character phone
 * reached NVARCHAR(30) and SQL Server aborted the write with a raw truncation
 * error naming the database, table and column.
 *
 * Now an over-long value is an ERROR, returned per field, and nothing is sent
 * to SQL until every field in the request passes.
 */
function buildSets(body, spec) {
  const sets = [];
  const params = [];
  const errors = {};
  let i = 0;
  for (const [col, type, max] of spec) {
    if (body[col] === undefined) continue;
    let v = body[col];
    if (v === '' || v === null) v = null;
    else if (type === 'int') v = int(v);
    else if (type === 'decimal') { const n = parseFloat(v); v = Number.isFinite(n) ? n : null; }
    else if (type === 'date') {
      v = String(v).slice(0, 10);
      // Client 15-10-2026: a date of birth can never be in the future.
      if (col === 'dob' && v > new Date().toISOString().slice(0, 10)) { errors[col] = 'Date of birth cannot be later than today'; continue; }
    }
    else if (type === 'bool') v = (v === true || v === 1 || v === '1' || v === 'true' || v === 'Yes') ? 1 : 0;
    else {
      v = String(v);
      const limit = max || 255;
      if (type !== 'longtext' && v.length > limit) {
        errors[col] = `Must be ${limit} characters or fewer (currently ${v.length})`;
        continue;
      }
      if (col === 'email' && !RX.email.test(v)) { errors[col] = 'Enter a valid email address'; continue; }
      if (col === 'phone' && !RX.phone.test(v)) { errors[col] = 'Enter a valid phone number'; continue; }
      // Client 15-10-2026: special characters refused across the application.
      if (!['email', 'phone', 'mobile', 'map_link'].includes(col)) {
        const msg = textError(v, ['full_name', 'first_name', 'last_name'].includes(col) ? 'name' : 'text');
        if (msg) { errors[col] = msg; continue; }
      }
    }
    sets.push(`${col} = @p${i}`);
    params.push(v);
    i += 1;
  }
  return { sets, params, next: i, errors };
}

// [column, type, real NVARCHAR width in dbo.applicants]
const APPLICANT_COLS = [
  ['first_name', 'text', 100], ['last_name', 'text', 100], ['company_name', 'text', 200],
  ['company_reg_no', 'text', 50],
  ['email', 'text', 150], ['phone', 'text', 30], ['national_id', 'text', 50],
  ['applicant_type_id', 'int'], ['dob', 'date'],
];

async function updateApplicant(appId, applicantId, body, req) {
  const link = await db.query(
    'SELECT 1 FROM application_applicants WHERE application_id = @p0 AND applicant_id = @p1', [appId, applicantId]);
  if (!link.length) return { notFound: true };
  const { sets, params, next, errors } = buildSets(body, APPLICANT_COLS);
  // Reject the whole request if ANY field is bad - a partial write would save
  // some boxes and silently drop the one the user actually got wrong.
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!sets.length) return { ok: true, id: applicantId };
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(applicantId);
  await db.query(
    `UPDATE applicants SET ${sets.join(', ')}, updated_by = @p${next}, updated_at = SYSUTCDATETIME()
      WHERE applicant_id = @p${next + 1}`,
    params,
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_APPLICANT_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'applicants', entityId: applicantId,
    details: { application_id: appId, fields: sets.map((x) => x.split(' ')[0]) },
  }));
  return { ok: true, id: applicantId };
}

// Company directors live on the ENQUIRY (enquiry_applicants). The application can
// EDIT an existing one (no add / remove); the write lands on that one row so the
// enquiry and the application both show the change.
const DIRECTOR_COLS = [
  ['full_name', 'text', 200], ['dob', 'date'], ['nationality', 'text', 80],
  ['address', 'text', 400], ['time_at_address', 'text', 80], ['email', 'text', 150],
  ['mobile', 'text', 40], ['owns_home', 'bool'], ['occupation', 'text', 150],
  ['employer_name', 'text', 200], ['business_address', 'text', 400],
  ['length_of_service', 'text', 80], ['relationship', 'text', 120],
  ['shareholding_pct', 'decimal'], ['prev_bridging', 'bool'], ['prev_bridging_lender', 'text', 200],
];

async function getEnquiryDocumentForApp(appId, docId) {
  const appRow = await db.query('SELECT enquiry_id FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [appId]);
  if (!appRow.length || !appRow[0].enquiry_id) return null;
  const rows = await db.query(
    `SELECT enquiry_document_id, file_name, file_path
       FROM enquiry_documents WHERE enquiry_document_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`,
    [docId, appRow[0].enquiry_id]);
  return rows.length ? rows[0] : null;
}

async function updateEnquiryDirector(appId, directorId, body, req) {
  const appRow = await db.query('SELECT enquiry_id FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [appId]);
  if (!appRow.length || !appRow[0].enquiry_id) return { notFound: true };
  const enquiryId = appRow[0].enquiry_id;
  const link = await db.query(
    'SELECT 1 FROM enquiry_applicants WHERE enquiry_applicant_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0', [directorId, enquiryId]);
  if (!link.length) return { notFound: true };
  const { sets, params, next, errors } = buildSets(body, DIRECTOR_COLS);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!sets.length) return { ok: true, id: directorId };
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(directorId);
  await db.query(
    `UPDATE enquiry_applicants SET ${sets.join(', ')}, updated_by = @p${next}, updated_at = SYSUTCDATETIME()
      WHERE enquiry_applicant_id = @p${next + 1}`, params);
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_DIRECTOR_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'enquiry_applicants', entityId: directorId,
    details: { application_id: appId, enquiry_id: enquiryId },
  }));
  return { ok: true, id: directorId };
}

// [column, type, real NVARCHAR width in dbo.application_security]
const SECURITY_COLS = [
  ['property_address', 'text', 255], ['charge_type', 'text', 40], ['valuation_status', 'text', 30],
  ['valuation_check', 'text', 30], ['risk_rating', 'text', 20], ['ltv_band', 'text', 30],
  ['legal_check_status', 'text', 30], ['estimated_value', 'decimal'], ['valuation_amount', 'decimal'],
  ['valuation_type_id', 'int'], ['valuation_date', 'date'],
  // the enquiry's property block, now editable on the application in its own right
  ['postcode', 'text', 20], ['property_type', 'text', 60], ['tenure', 'text', 30], ['tenure_years', 'int'],
  ['gdv', 'decimal'], ['owns_property', 'bool'], ['purchase_price', 'decimal'],
  ['purchase_date', 'date'], ['outstanding_loan', 'decimal'],
  ['charge_amount', 'decimal'], // 2nd-charge amount, editable like on the enquiry (client 15-10-2026)
  ['repaid_on_completion', 'bool'], ['lender', 'text', 150], ['added_value', 'longtext', 500],
  ['map_link', 'text', 500],
];

async function updateSecurity(appId, securityId, body, req) {
  const link = await db.query(
    'SELECT 1 FROM application_security WHERE application_id = @p0 AND security_id = @p1 AND flag_deleted = 0', [appId, securityId]);
  if (!link.length) return { notFound: true };
  const { sets, params, next, errors } = buildSets(body, SECURITY_COLS);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!sets.length) return { ok: true, id: securityId };
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(securityId);
  await db.query(
    `UPDATE application_security SET ${sets.join(', ')}, updated_by = @p${next}, updated_at = SYSUTCDATETIME()
      WHERE security_id = @p${next + 1}`,
    params,
  );
  await audit.write(audit.fromReq(req, {
    action: 'APPLICATION_SECURITY_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'application_security', entityId: securityId,
    details: { application_id: appId, fields: sets.map((x) => x.split(' ')[0]) },
  }));
  return { ok: true, id: securityId };
}

module.exports = {
  validate, generateRef, list, getById, create, update, changeStatus, listNotes,
  addTask, updateTask, addCommunication, addNote, requestInfo,
  addDocument, getDocument, updateDocument, deleteDocument,
  stageCounts, formOptions, updateApplicant, updateSecurity, updateEnquiryDirector, getEnquiryDocumentForApp,
};
