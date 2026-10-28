'use strict';

/**
 * Enquiry service (Module-4). ALL business logic lives here so the controller
 * stays a thin HTTP layer (mirrors the project's masters/user pattern):
 *   - server-side validation & coercion from config/enquiry.config.js
 *   - auto-generated enquiry reference
 *   - list (search / filter / sort / paginate), get (with joins + timeline)
 *   - create (manual + website), update
 *   - assignment with history (previous owner, new owner, changed by, time)
 *   - notes / activity timeline
 *   - status changes via the central workflow service
 *   - convert-to-application with the configurable convert rule set
 *
 * A03 Injection: values are always bound (@pN); identifiers come only from the
 * trusted config, never from the request.
 */

const fs = require('fs');
const path = require('path');
const fileGuard = require('../utils/fileGuard');
const db = require('../config/database');
const audit = require('./audit.service');
const mail = require('./mail.service');
const emailHub = require('./emailHub.service');
const workflow = require('./workflow.service');
const CFG = require('../config/enquiry.config');
const { LATEST_GROSS_APPLY, LOAN_AMOUNT_SQL, LOAN_BASIS_SQL, ENQ_NET_SQL } = require('../utils/loanAmount');
const { ltvPair, totalLtv } = require('../utils/ltv');
const { textError } = require('../utils/textRules');
const notify = require('./notification.service');

const RX = {
  text: /^[A-Za-z0-9 .,&/'()\-#:\n\r]+$/,
  phone: /^[0-9+()\-\s]+$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
};

const int = (v, d = null) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/** Validate + coerce a request body against the config field list.
 *  partial=true (update) skips 'required' checks for absent fields. */
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
/** Today as YYYY-MM-DD in the SERVER's local time (matches the browser's date input). */
function todayISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function validate(body, { partial = false, staff = false } = {}) {
  const errors = {};
  const values = {};
  for (const col of CFG.FIELDS) {
    const has = Object.prototype.hasOwnProperty.call(body, col.name);
    if (partial && !has) continue;
    const raw = body[col.name];
    if (raw === undefined || raw === null || raw === '') {
      if ((col.required || (staff && col.staffRequired) || (!staff && col.publicRequired)) && !partial) errors[col.name] = 'This field is required';
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
      case 'bool': {
        const sv = String(v).toLowerCase();
        if (['1', 'true', 'yes', 'y'].includes(sv)) values[col.name] = 1;
        else if (['0', 'false', 'no', 'n'].includes(sv)) values[col.name] = 0;
        else errors[col.name] = 'Please choose Yes or No';
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
        // Fields flagged notFuture in enquiry.config (dob, requested completion)
        // are rejected when later than today. ISO strings compare correctly as text.
        else if (col.notFuture && str > todayISO()) errors[col.name] = 'Cannot be later than today';
        else values[col.name] = str;
        break;
      }
      default: { // text | longtext
        const long = tooLong(col, v);
        if (col.type !== 'longtext' && !RX.text.test(String(v))) {
          errors[col.name] = 'Contains characters that are not allowed';
        } else if (long) {
          errors[col.name] = long;
        } else {
          values[col.name] = String(v);
        }
      }
    }
  }
  // Client 15-10-2026: people's names take letters / spaces / . ' - only.
  for (const k of ['applicant_name', 'borrower_sol_contact']) {
    const msg = values[k] != null ? textError(values[k], 'name') : null;
    if (msg && !errors[k]) errors[k] = msg;
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

/**
 * Solicitor representation (client 15-10-2026): rep_type is 'single' | 'dual' (anything
 * else -> null). Dual rep = our solicitor acts for both sides, so the borrower-solicitor
 * fields are cleared. Mutates `values` (only keys already present on a partial update).
 */
const BORROWER_SOL_COLS = ['borrower_sol_firm', 'borrower_sol_contact', 'borrower_sol_address', 'borrower_sol_telephone', 'borrower_sol_email'];
function normRep(values) {
  if (!('rep_type' in values)) return;
  const r = String(values.rep_type || '').trim().toLowerCase();
  values.rep_type = r.startsWith('dual') ? 'dual' : (r.startsWith('single') ? 'single' : null);
  if (values.rep_type === 'dual') BORROWER_SOL_COLS.forEach((c) => { values[c] = null; });
  normDealType(values);
}

/** Type of Deal (client 26-10-2026): one of DEAL_TYPES, matched case-insensitively; else null. */
const DEAL_TYPES = ['Residential', 'Commercial', 'Mixed'];
function normDealType(values) {
  if (!('deal_type' in values)) return;
  const d = String(values.deal_type || '').trim().toLowerCase();
  values.deal_type = DEAL_TYPES.find((t) => t.toLowerCase() === d) || null;
}

/**
 * Borrower's solicitor from the Solicitor master (client 15-10-2026). When the payload
 * carries borrower_solicitor_id, the five borrower_sol_* snapshot columns are (re)filled
 * from that master row, so every downstream reader (underwriting step 4, application form,
 * credit paper) keeps working off the same columns. Dual rep clears the link too.
 * Call AFTER normRep(). Mutates `values`.
 */
async function applyBorrowerSolicitor(values) {
  if (values.rep_type === 'dual') { values.borrower_solicitor_id = null; return; }
  if (!('borrower_solicitor_id' in values)) return;
  const sid = Number(values.borrower_solicitor_id) || null;
  values.borrower_solicitor_id = sid;
  if (!sid) { BORROWER_SOL_COLS.forEach((c) => { values[c] = null; }); return; }
  const r = await db.query(
    `SELECT TOP 1 firm_name, contact_name, address, telephone, email FROM borrower_solicitors
      WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0`, [sid]);
  if (!r.length) { values.borrower_solicitor_id = null; return; }
  const s = r[0];
  values.borrower_sol_firm = s.firm_name || null;
  values.borrower_sol_contact = s.contact_name || null;
  values.borrower_sol_address = s.address || null;
  values.borrower_sol_telephone = s.telephone || null;
  values.borrower_sol_email = s.email || null;
}

/** Auto-generate a unique enquiry reference: ENQ-YYYY-NNNNN. */
async function generateRef() {
  const year = new Date().getFullYear();
  const prefix = `${CFG.REF_PREFIX}-${year}-`;
  const rows = await db.query(
    `SELECT TOP 1 enquiry_ref FROM enquiries WHERE enquiry_ref LIKE @p0 ORDER BY enquiry_ref DESC`,
    [prefix + '%'],
  );
  let next = 1;
  if (rows.length) {
    const tail = String(rows[0].enquiry_ref).slice(prefix.length);
    const n = parseInt(tail, 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  return prefix + String(next).padStart(5, '0');
}

/** Same scheme for the generated application ref (APP-YYYY-NNNNN). */
async function generateAppRef() {
  const year = new Date().getFullYear();
  const prefix = `APP-${year}-`;
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

/**
 * Est. LTV = (gross loan amount + outstanding loan) / estimated property value * 100 (2 dp).
 * The outstanding loan is the "Outstanding loan (£)" on step 4 — client 25-09-2026:
 * a £100,000 2nd-charge request + £100,000 outstanding on a £400,000 property = 50%.
 */
function computeLtv(amount, value, outstanding) {
  const a = Number(amount);
  const v = Number(value);
  const o = Number(outstanding);
  if (!Number.isFinite(a) || !Number.isFinite(v) || a <= 0 || v <= 0) return null;
  const owed = Number.isFinite(o) && o > 0 ? o : 0;
  const ltv = Math.round(((a + owed) / v) * 10000) / 100;
  return ltv > 999.999 ? 999.999 : ltv; // ltv_pct DECIMAL(6,3) max
}

/** Debt already secured on ONE property: outstanding loan + charge amount (2nd charge only). */
function securityDebt(s) {
  if (!s) return 0;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  // Client 09-10-2026: the Outstanding Loan box was removed from the enquiry; the only
  // existing debt counted now is a prior 2nd-charge amount.
  return (String(s.charge_type || '') === '2nd' ? num(s.charge_amount) : 0);
}

/**
 * Est. LTV of an ENQUIRY (add popup steps 4 + 5, header, Security tab) — client 29-09-2026 13:28:
 *   Est. LTV = Σ (outstanding loans + 2nd-charge amounts) ÷ Σ property values × 100  (30-09-2026)
 *   e.g. property value 150,000, outstanding 50,000 -> 33.33%.
 * Multiple securities: same formula, values summed. Older securities saved with
 * `existing_charge` (no outstanding_loan) count that as their outstanding loan.
 */
function computeCombinedLtv(main, securities) {
  const list = Array.isArray(securities) ? securities : [];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  let value = num(main && main.estimated_value);
  // Client 06-10-2026: the Est. LTV must INCLUDE the requested gross loan, not just
  // existing charges. Est. LTV = (requested gross loan + Σ existing debt) ÷ Σ values.
  // (Existing debt = outstanding loan + 2nd-charge amount on every security.)
  let owed = securityDebt(main) + num(main && main.amount_requested);
  for (const x of list) {
    value += num(x && x.estimated_value);
    owed += x && x.outstanding_loan == null && x.charge_amount == null ? num(x.existing_charge) : securityDebt(x);
  }
  if (value <= 0) return null;
  const ltv = Math.round((owed / value) * 10000) / 100;
  return ltv > 999.999 ? 999.999 : ltv; // ltv_pct DECIMAL(6,3) max
}

/**
 * LTV of the LOAN on an application (set at convert): gross loan ÷ property value
 * after outstanding loans and 2nd-charge amounts — the Send Indicative LTV % rule.
 */
function computeLoanLtv(main, securities) {
  const list = Array.isArray(securities) ? securities : [];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  let value = num(main && main.estimated_value);
  let debt = securityDebt(main);
  for (const x of list) {
    value += num(x && x.estimated_value);
    debt += securityDebt(x) + (x && x.outstanding_loan == null ? num(x.existing_charge) : 0);
  }
  const a = Number(main && main.amount_requested);
  const net = value - debt;
  if (!Number.isFinite(a) || a <= 0 || net <= 0) return null;
  const ltv = Math.round((a / net) * 10000) / 100;
  return ltv > 999.999 ? 999.999 : ltv;
}

/** charge_amount only means something on a 2nd charge — drop it otherwise. */
function cleanSecurityRows(list) {
  if (!Array.isArray(list)) return list;
  return list.map((x) => {
    if (!x || typeof x !== 'object') return x;
    const row = { ...x };
    if (String(row.charge_type || '') !== '2nd') delete row.charge_amount;
    return row;
  });
}

/** Google Maps links only (the Security tab embeds a map from it). */
const MAP_HOSTS = /^((www\.|maps\.)?google\.(com|co\.uk)|goo\.gl|maps\.app\.goo\.gl)$/i;
function checkMapLink(v) {
  if (v == null || v === '') return null;
  let u;
  try { u = new URL(String(v).trim()); } catch (_) { return 'Enter a valid Google Maps link'; }
  if (u.protocol !== 'https:' || !MAP_HOSTS.test(u.hostname)) return 'Enter a valid Google Maps link';
  if (/^goo\.gl$/i.test(u.hostname) && !u.pathname.startsWith('/maps')) return 'Enter a valid Google Maps link';
  return null;
}

/** Enquiry drawdowns [{month, amount}] -> clean JSON string (null when none). */
function cleanDrawdowns(list, errors) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  list.forEach((d, i) => {
    const m = d && d.month !== '' && d.month != null ? Number(d.month) : null;
    const a = d && d.amount !== '' && d.amount != null ? Number(d.amount) : null;
    if (m === null && a === null) return;                       // empty row
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 600)) errors[`drawdowns[${i}].month`] = 'Month must be a whole number 1-600';
    if (a === null || !Number.isFinite(a) || a <= 0 || a > 999999999999) errors[`drawdowns[${i}].amount`] = 'Enter a valid amount';
    out.push({ month: m, amount: a });
  });
  return out.length ? JSON.stringify(out) : null;
}

const SELECT_LIST = `
  e.enquiry_id, e.enquiry_ref, e.applicant_name, e.company_name, e.email, e.phone,
  e.amount_requested, e.loan_basis, e.term_months, e.interest_type, e.assigned_to, e.enquiry_status_id, e.updated_at,
  e.branch_id, e.product_id, e.loan_purpose_id, e.application_source_id, e.broker_id,
  e.converted_application_id, e.created_at,
  e.lead_source_id, COALESCE(ls.name, e.lead_source) AS lead_source, e.broker_name AS broker_name_text, e.dob, e.requested_completion_date,
  e.company_reg_no, e.ltv_pct, e.total_ltv_pct, e.property_address, e.estimated_value,
  e.postcode, e.property_type, e.deal_type, e.tenure, e.tenure_years, e.charge_type, e.gdv,
  e.owns_property, e.purchase_price, e.purchase_date, e.outstanding_loan, e.charge_amount,
  e.repaid_on_completion, e.lender, e.added_value,
  e.offer_amount, e.offer_rate, e.offer_valid_until, e.offer_notes, e.offer_sent_at, e.indicative_sent_at, e.offer_accepted_at,
  -- Gross from the accepted/sent offer, else a SENT indicative (lg, see JOINS). A NET
  -- figure typed on the enquiry is NOT a gross loan, so it is left out here (client 14-10-2026).
  COALESCE(lg.gross, CASE WHEN e.loan_basis = 'Net' THEN NULL ELSE e.amount_requested END) AS gross_loan_accepted,
  -- "Loan Amount" column (client 15-10-2026): the figure + its basis, shown as
  -- "NET £200,000" / "GROSS £200,000". Once an offer / sent indicative exists its gross wins.
  ${LOAN_AMOUNT_SQL} AS loan_amount,
  ${LOAN_BASIS_SQL} AS loan_amount_basis,
  -- Actual gross / net once an indicative is sent or an offer exists (client 15-10-2026):
  -- the detail header + Financials show them instead of the amount typed on the enquiry.
  lg.gross AS latest_gross, ${ENQ_NET_SQL} AS net_loan,
  st.code AS status_code, st.name AS status_name,
  b.branch_name, p.name AS product_name, lp.name AS purpose_name,
  src.name AS source_name, br.name AS broker_name, br.company AS broker_company, br.email AS broker_email, br.phone AS broker_phone,
  u.full_name AS assigned_to_name, u.email AS assigned_to_email`;

const JOINS = `
  FROM enquiries e
  LEFT JOIN enquiry_statuses st ON st.enquiry_status_id = e.enquiry_status_id
  LEFT JOIN branches b   ON b.branch_id = e.branch_id
  LEFT JOIN products p   ON p.product_id = e.product_id
  LEFT JOIN loan_purposes lp ON lp.loan_purpose_id = e.loan_purpose_id
  LEFT JOIN application_sources src ON src.application_source_id = e.application_source_id
  LEFT JOIN brokers br   ON br.broker_id = e.broker_id
  LEFT JOIN lead_sources ls ON ls.lead_source_id = e.lead_source_id
  LEFT JOIN users u      ON u.user_id = e.assigned_to
  ${LATEST_GROSS_APPLY}`;

async function list(q, opts = {}) {
  const page = Math.max(1, int(q.page, 1));
  const per = Math.min(5000, /* pagination removed (client 21-10-2026) - was 100 */ Math.max(1, int(q.per_page, 20)));
  const p = {};
  let where = 'e.flag_deleted = 0';

  const search = String(q.search || '').trim();
  if (search) {
    where += ' AND (' + CFG.SEARCH.map((c) => `e.${c} LIKE @search`).join(' OR ') + ')';
    p.search = '%' + search + '%';
  }
  if (int(q.status_id)) { where += ' AND e.enquiry_status_id = @status_id'; p.status_id = int(q.status_id); }
  // status_code accepts one code, a comma list ('NEW,UNASSIGNED'), or the sentinel
  // 'LIVE' (client 06-10-2026) = every non-terminal enquiry (hides Converted /
  // Declined / Closed), which is the default view so staff see only live work.
  const rawStatus = String(q.status_code || '').trim().toUpperCase();
  if (rawStatus === 'LIVE') {
    where += " AND st.code NOT IN ('CONVERTED','LOST','CLOSED')";
  } else if (rawStatus) {
    const codes = rawStatus.split(',').map((c) => c.trim()).filter(Boolean);
    if (codes.length === 1) { where += ' AND st.code = @status_code'; p.status_code = codes[0]; }
    else {
      where += ' AND st.code IN (' + codes.map((_, i) => '@status_code' + i).join(', ') + ')';
      codes.forEach((c, i) => { p['status_code' + i] = c; });
    }
  }
  if (int(q.assigned_to)) { where += ' AND e.assigned_to = @assigned_to'; p.assigned_to = int(q.assigned_to); }
  if (String(q.assigned_to) === 'none') { where += ' AND e.assigned_to IS NULL'; }
  if (int(q.branch_id)) { where += ' AND e.branch_id = @branch_id'; p.branch_id = int(q.branch_id); }
  if (int(q.product_id)) { where += ' AND e.product_id = @product_id'; p.product_id = int(q.product_id); }
  if (int(q.source_id)) { where += ' AND e.application_source_id = @source_id'; p.source_id = int(q.source_id); }

  // view scope: when the caller lacks ENQUIRY_LIST.view_all they see only their own assignees
  if (int(opts.scopeUserId)) { where += ' AND e.assigned_to = @scope_uid'; p.scope_uid = int(opts.scopeUserId); }
  // "My deals" toggle (same as Underwriting): only enquiries this BDM owns.
  if (int(q.mine) && int(opts.currentUserId)) { where += ' AND e.assigned_to = @me'; p.me = int(opts.currentUserId); }

  // safe sort — whitelist only
  const sortCol = CFG.SORTABLE.includes(String(q.sort)) ? String(q.sort) : 'enquiry_id';
  const sortDir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  p.off = (page - 1) * per;
  p.lim = per;
  const rows = await db.queryNamed(
    `SELECT ${SELECT_LIST} ${JOINS} WHERE ${where}
     ORDER BY ${sortCol === 'amount_requested' ? LOAN_AMOUNT_SQL : 'e.' + sortCol} ${sortDir} OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
    p,
  );
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total ${JOINS} WHERE ${where}`, p);
  const total = cnt[0] ? cnt[0].total : 0;
  return { rows, meta: { page, per_page: per, total, total_pages: Math.ceil(total / per) || 1 } };
}

async function getById(id) {
  const rows = await db.query(
    `SELECT ${SELECT_LIST}, e.summary, e.lost_reason, e.additional_securities,
            e.rep_type, e.borrower_solicitor_id, e.borrower_sol_firm, e.borrower_sol_contact, e.borrower_sol_address,
            e.borrower_sol_telephone, e.borrower_sol_email,
            e.deal_appraisal, e.exit_strategy, e.risk_mitigants, e.credit_recommendation,
            e.drawdowns_required, e.drawdowns, e.map_link,
            e.total_project_cost, e.deposit_source, e.own_contribution, e.additional_borrowing,
            e.applicant_type_id, at.name AS applicant_type_name, e.converted_at,
            capp.application_ref AS converted_application_ref
     ${JOINS}
     LEFT JOIN applicant_types at ON at.applicant_type_id = e.applicant_type_id
     LEFT JOIN applications capp ON capp.application_id = e.converted_application_id
     WHERE e.enquiry_id = @p0 AND e.flag_deleted = 0`,
    [id],
  );
  if (!rows.length) return null;
  const enquiry = rows[0];
  enquiry.notes = await listNotes(id);
  enquiry.assignments = await db.query(
    `SELECT a.assignment_id, a.assigned_to, nu.full_name AS assigned_to_name,
            a.previous_assigned_to, pu.full_name AS previous_assigned_to_name,
            a.assigned_by, bu.full_name AS assigned_by_name, a.assigned_at, a.note
       FROM enquiry_assignments a
       LEFT JOIN users nu ON nu.user_id = a.assigned_to
       LEFT JOIN users pu ON pu.user_id = a.previous_assigned_to
       LEFT JOIN users bu ON bu.user_id = a.assigned_by
      WHERE a.enquiry_id = @p0 ORDER BY a.assigned_at DESC`,
    [id],
  );
  enquiry.documents = await db.query(
    `SELECT d.enquiry_document_id, d.file_name, d.file_path, d.document_type_id,
            COALESCE(dt.name, d.type_other) AS document_type_name, d.created_at, d.uploaded_by
       FROM enquiry_documents d
       LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
      WHERE d.enquiry_id = @p0 AND d.flag_deleted = 0
      ORDER BY d.enquiry_document_id DESC`,
    [id],
  );
  enquiry.applicants = await listApplicants(id);
  try { enquiry.additional_securities = enquiry.additional_securities ? JSON.parse(enquiry.additional_securities) : []; } catch (_) { enquiry.additional_securities = []; }
  try { enquiry.drawdowns = enquiry.drawdowns ? JSON.parse(enquiry.drawdowns) : []; } catch (_) { enquiry.drawdowns = []; }
  // Top bar (client 15-10-2026): once an offer is sent its gross / term / LTV are the
  // loan's CURRENT figures; the Loan Request tab keeps what was first asked for.
  enquiry.current_terms = await currentOfferTerms(id, enquiry).catch(() => null);
  // ONE LTV everywhere on this page (client 15-10-2026): our LTV on the CURRENT gross -
  // offer gross, else the sent indicative's gross, else the typed amount when it is a
  // gross figure. The stored ltv_pct is from the amount first typed (and a Net amount is
  // not a loan), so header (offer) and Financials (typed) disagreed: 50% vs 33.33%.
  {
    const secs = [enquiry, ...(Array.isArray(enquiry.additional_securities) ? enquiry.additional_securities : [])];
    // Client 19-10-2026: LTV = the loan typed on the enquiry ÷ property values (our loan
    // only), worked out when the enquiry was added / last edited. Sending an indicative or
    // offer does NOT change it.
    enquiry.current_ltv_pct = ltvPair(enquiry.amount_requested, secs).our;
    // Total LTV (Summary tab) = (typed amount + other charges) ÷ all security values, until
    // an indicative / offer is sent - then it is the LTV % entered in the calculator popup
    // (that box is seeded with this Total LTV, so what is typed there is a Total LTV).
    enquiry.summary_total_ltv_pct = enquiry.total_ltv_pct != null ? Number(enquiry.total_ltv_pct)
      : totalLtv(enquiry.amount_requested, secs);
    enquiry.current_total_ltv_pct = null; // client 16-10-2026: no "total LTV" anywhere
    //   offer sent      -> the offer's LTV (= its indicative's LTV %)
    //   indicative sent -> the LTV % on the latest sent indicative
    if (enquiry.current_terms && enquiry.current_terms.ltv_pct != null) {
      enquiry.summary_total_ltv_pct = enquiry.current_terms.ltv_pct;
    } else {
      const ind = await db.query(
        `SELECT TOP 1 calc_json FROM enquiry_indicatives
          WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status = 'Sent'
          ORDER BY version_no DESC`, [id]).catch(() => []);
      let c = null;
      try { c = ind.length && ind[0].calc_json ? JSON.parse(ind[0].calc_json) : null; } catch (_) { c = null; }
      const il = c ? Number(c.ltv_pct) : NaN;
      if (Number.isFinite(il) && il > 0) enquiry.summary_total_ltv_pct = Math.round(il * 100) / 100;
    }
  }
  // Application form (client 15-10-2026): section 1 = the BROKER (introducer) from the
  // Broker master, section 5 = the borrower's solicitor master row (SRA partners).
  // SELECT * so a DB without migration 079 still loads the enquiry.
  enquiry.broker = null;
  if (enquiry.broker_id) {
    const b = await db.query('SELECT TOP 1 * FROM brokers WHERE broker_id = @p0', [enquiry.broker_id]).catch(() => []);
    if (b.length) {
      const r = b[0];
      enquiry.broker = { name: r.name, company: r.company, email: r.email, phone: r.phone, address: r.address ?? null, fca_number: r.fca_number ?? null, commission_pct: r.commission_pct ?? null };
    }
  }
  // Broker Fee on the application form = what was entered on the latest indicative (% or £).
  enquiry.indicative_broker_fee = null;
  {
    const ir = await db.query(
      `SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0
        ORDER BY CASE WHEN status = 'Sent' THEN 0 ELSE 1 END, version_no DESC`, [id]).catch(() => []);
    let c = null;
    try { c = ir.length && ir[0].calc_json ? JSON.parse(ir[0].calc_json) : null; } catch (_) { c = null; }
    if (c && c.broker_fee != null) {
      enquiry.indicative_broker_fee = { amount: c.broker_fee, pct: c.broker_fee_pct ?? null, is_pct: c.broker_fee_is_pct !== false };
    }
  }
  enquiry.borrower_solicitor = null;
  if (enquiry.borrower_solicitor_id) {
    const bs = await db.query('SELECT TOP 1 * FROM borrower_solicitors WHERE borrower_solicitor_id = @p0', [enquiry.borrower_solicitor_id]).catch(() => []);
    if (bs.length) enquiry.borrower_solicitor = { sra_partners: bs[0].sra_partners ?? null };
  }
  enquiry.declines = await listDeclines(id);
  // The decline that is still in force (enquiry is LOST and not re-opened since).
  const last = enquiry.declines[0];
  enquiry.decline = String(enquiry.status_code || '').toUpperCase() === 'LOST' && last && !last.reopened_at ? last : null;
  return enquiry;
}

/** Columns persisted per applicant (PDF section 4). Keys are trusted. */
const APPLICANT_COLS = [
  'full_name', 'dob', 'nationality', 'address', 'time_at_address', 'email', 'mobile',
  'owns_home', 'occupation', 'employer_name', 'business_address', 'length_of_service',
  'relationship', 'shareholding_pct', 'prev_bridging', 'prev_bridging_lender',
  'is_primary', 'sort_order',
];
const APPLICANT_BOOL = new Set(['owns_home', 'prev_bridging', 'is_primary']);
const APPLICANT_DEC = new Set(['shareholding_pct']);
/**
 * Numeric range for each applicant decimal, matching its SQL column so a value
 * can never overflow it. shareholding_pct is DECIMAL(6,2): a share is a
 * percentage, so 0-100 is both the sensible and the safe bound. Without this an
 * out-of-range % reached DECIMAL(6,2) and SQL aborted the ENTIRE enquiry insert
 * with "Arithmetic overflow error converting int to data type numeric."
 */
const APPLICANT_DEC_RANGE = { shareholding_pct: { min: 0, max: 100 } };
const APPLICANT_INT = new Set(['sort_order']);
const APPLICANT_DATE = new Set(['dob']);

/**
 * Real NVARCHAR widths of dbo.enquiry_applicants. The old code sliced EVERY
 * text field to 400, which silently truncated an over-long nationality (80) or
 * relationship (120) and would still have burst the narrower columns.
 */
const APPLICANT_MAX = {
  full_name: 200, nationality: 80, address: 400, time_at_address: 80,
  email: 150, mobile: 40, occupation: 150, employer_name: 200,
  business_address: 400, length_of_service: 80, relationship: 120,
  prev_bridging_lender: 200,
};

/** Validate one applicant row; returns { errors, row }. */
function validateApplicant(raw, index) {
  const errors = {};
  const row = coerceApplicant(raw || {});
  for (const [k, max] of Object.entries(APPLICANT_MAX)) {
    const v = raw ? raw[k] : null;
    if (v == null || v === '') continue;
    if (String(v).length > max) {
      errors[`applicants[${index}].${k}`] = `Must be ${max} characters or fewer (currently ${String(v).length})`;
    }
  }
  if (raw && raw.email && !RX.email.test(String(raw.email))) {
    errors[`applicants[${index}].email`] = 'Enter a valid email address';
  }
  // Client 15-10-2026: no special characters (a director "SELECT * FROM users" got through).
  {
    const nm = textError(raw && raw.full_name, 'name');
    if (nm) errors[`applicants[${index}].full_name`] = nm;
    for (const k of ['nationality', 'address', 'time_at_address', 'occupation', 'employer_name',
      'business_address', 'length_of_service', 'relationship', 'prev_bridging_lender']) {
      const m = textError(raw && raw[k], 'text');
      if (m) errors[`applicants[${index}].${k}`] = m;
    }
  }
  if (raw && raw.mobile && !RX.phone.test(String(raw.mobile))) {
    errors[`applicants[${index}].mobile`] = 'Enter a valid phone number';
  }
  // Client 15-10-2026: date of birth can never be in the future (every applicant / director).
  if (raw && raw.dob && String(raw.dob).slice(0, 10) > todayISO()) {
    errors[`applicants[${index}].dob`] = 'Date of birth cannot be later than today';
  }
  // Numeric fields must sit inside the SQL column's range, or the insert aborts
  // with an arithmetic-overflow error that fails the whole enquiry (not just the
  // one field). Check every applicant decimal up-front with a clear message.
  for (const [k, range] of Object.entries(APPLICANT_DEC_RANGE)) {
    const v = raw ? raw[k] : null;
    if (v == null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      errors[`applicants[${index}].${k}`] = 'Must be a valid number';
    } else if (n < range.min || n > range.max) {
      errors[`applicants[${index}].${k}`] = `Must be between ${range.min} and ${range.max}`;
    }
  }
  return { errors, row };
}

/** Validate the whole applicant list up-front, so nothing reaches SQL half-checked. */
function validateApplicants(applicants, { staff = false } = {}) {
  if (!Array.isArray(applicants)) return {};
  let errors = {};
  applicants.forEach((a, i) => { errors = { ...errors, ...validateApplicant(a, i).errors }; });
  // Borrower details (name / email / mobile) are optional on the staff form —
  // client 25-09-2026: the borrower is often unknown when the enquiry arrives.
  void staff;
  return errors;
}

function coerceApplicant(raw) {
  const out = {};
  for (const k of APPLICANT_COLS) {
    let v = raw[k];
    if (v === undefined) continue;
    if (v === '' ) { out[k] = null; continue; }
    if (v === null) { out[k] = null; continue; }
    if (APPLICANT_BOOL.has(k)) {
      const sv = String(v).toLowerCase();
      out[k] = ['1', 'true', 'yes', 'y'].includes(sv) ? 1 : (['0', 'false', 'no', 'n'].includes(sv) ? 0 : null);
    } else if (APPLICANT_DEC.has(k)) {
      const n = Number(v);
      if (!Number.isFinite(n)) { out[k] = null; }
      else {
        // Last-resort clamp so no path (e.g. public intake) can ever overflow the
        // DECIMAL column; the user-facing out-of-range error comes from validate.
        const r = APPLICANT_DEC_RANGE[k];
        out[k] = r ? Math.min(Math.max(n, r.min), r.max) : n;
      }
    } else if (APPLICANT_INT.has(k)) {
      const n = Number(v); out[k] = Number.isInteger(n) ? n : 0;
    } else if (APPLICANT_DATE.has(k)) {
      const str = String(v).slice(0, 10); out[k] = /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
    } else {
      // Clamp to the column's real width, not a blanket 400.
      out[k] = String(v).slice(0, APPLICANT_MAX[k] || 400);
    }
  }
  return out;
}

async function listApplicants(enquiryId) {
  return db.query(
    `SELECT enquiry_applicant_id, enquiry_id, sort_order, is_primary, full_name, dob,
            nationality, address, time_at_address, email, mobile, owns_home, occupation,
            employer_name, business_address, length_of_service, relationship,
            shareholding_pct, prev_bridging, prev_bridging_lender
       FROM enquiry_applicants
      WHERE enquiry_id = @p0 AND flag_deleted = 0
      ORDER BY is_primary DESC, sort_order, enquiry_applicant_id`,
    [enquiryId],
  );
}

/** Replace the applicant list for an enquiry (soft-delete old, insert new). */
async function saveApplicants(enquiryId, applicants, req) {
  if (!Array.isArray(applicants)) return;
  const userId = req && req.userData ? req.userData.userId : null;
  await db.query(
    `UPDATE enquiry_applicants SET flag_deleted = 1, deleted_on = SYSUTCDATETIME(), updated_by = @p1
      WHERE enquiry_id = @p0 AND flag_deleted = 0`,
    [enquiryId, userId],
  );
  let order = 0;
  for (const a of applicants) {
    const row = coerceApplicant(a || {});
    if (!('sort_order' in row) || row.sort_order == null) row.sort_order = order;
    order += 1;
    // skip entirely empty rows
    const hasData = Object.entries(row).some(([k, v]) => !['sort_order', 'is_primary'].includes(k) && v != null && v !== '');
    if (!hasData) continue;
    row.enquiry_id = enquiryId;
    row.created_by = userId;
    const keys = Object.keys(row);
    const params = keys.map((k) => row[k]);
    const ph = keys.map((_, i) => '@p' + i).join(', ');
    await db.query(`INSERT INTO enquiry_applicants (${keys.join(', ')}) VALUES (${ph})`, params);
  }
}

const DOC_DIR = path.join('uploads', 'enquiry_documents');

/** Store an uploaded document (base64 JSON) under uploads/enquiry_documents. */
async function addDocument(id, body, req) {
  const exists = await db.query('SELECT 1 FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0', [id]);
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
  const rel = path.join(DOC_DIR, safe).replace(/\\/g, '/');
  const uid = req && req.userData ? req.userData.userId : null;
  const dtid = int(body.document_type_id) || null;
  const typeOther = body.document_type_name ? String(body.document_type_name).slice(0, 100) : null;
  const ins = await db.query(
    `INSERT INTO enquiry_documents (enquiry_id, document_type_id, type_other, file_name, file_path, uploaded_by, created_by)
     OUTPUT INSERTED.enquiry_document_id AS id
     VALUES (@p0, @p1, @p5, @p2, @p3, @p4, @p4)`,
    [id, dtid, chk.name, rel, uid, typeOther],
  );
  return { ok: true, id: ins[0] ? ins[0].id : null };
}

async function getDocument(enqId, docId) {
  const rows = await db.query(
    `SELECT enquiry_document_id, enquiry_id, file_name, file_path
       FROM enquiry_documents WHERE enquiry_document_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`,
    [docId, enqId],
  );
  return rows.length ? rows[0] : null;
}

async function updateDocument(enqId, docId, body, req) {
  const rows = await db.query('SELECT file_path FROM enquiry_documents WHERE enquiry_document_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0', [docId, enqId]);
  if (!rows.length) return { notFound: true };
  const sets = []; const params = [docId, enqId]; let i = 2;
  if (body.document_type_id !== undefined) { sets.push(`document_type_id = @p${i}`); params.push(int(body.document_type_id) || null); i++; }
  if (body.content_base64) {
    const name = String(body.file_name || '').trim() || 'document';
    const buf = Buffer.from(String(body.content_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const chk = fileGuard.checkUpload(name, buf);
    if (!chk.ok) return { ok: false, errors: { file: chk.error } };
    const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
    if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
    const safe = fileGuard.diskName(chk.name);
    fs.writeFileSync(path.join(absDir, safe), buf);
    const rel = path.join(DOC_DIR, safe).replace(/\\/g, '/');
    sets.push(`file_name = @p${i}`); params.push(chk.name); i++;
    sets.push(`file_path = @p${i}`); params.push(rel); i++;
  }
  if (!sets.length) return { ok: true };
  sets.push(`updated_by = @p${i}`); params.push(req && req.userData ? req.userData.userId : null);
  await db.query(`UPDATE enquiry_documents SET ${sets.join(', ')}, updated_at = SYSUTCDATETIME() WHERE enquiry_document_id = @p0 AND enquiry_id = @p1`, params);
  return { ok: true };
}

async function deleteDocument(enqId, docId, req) {
  await db.query(
    `UPDATE enquiry_documents SET flag_deleted = 1, updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE enquiry_document_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`,
    [docId, enqId, req && req.userData ? req.userData.userId : null],
  );
  return { ok: true };
}

/** Save the initial offer; when send=true, stamp offer_sent_at and move to QUALIFIED. */
async function saveOffer(id, body, req) {
  const exists = await db.query('SELECT 1 FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { notFound: true };
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const amt = num(body.offer_amount);
  const rate = num(body.offer_rate);
  const valid = body.offer_valid_until ? String(body.offer_valid_until).slice(0, 10) : null;
  const notes = body.offer_notes != null ? String(body.offer_notes) : null;
  const send = body.send === true || body.send === 'true';
  if (send) {
    // Client 06-10-2026: an offer cannot be SENT unless an indicative has actually
    // been sent to the applicant first (mirrors the versioned offer flow in
    // enquiry.offer.service.saveOfferVersion). Guards the legacy path too.
    const sentInd = await db.query(
      `SELECT TOP 1 1 AS ok FROM enquiry_indicatives
        WHERE enquiry_id = @p0 AND flag_deleted = 0 AND sent_at IS NOT NULL`, [id]);
    if (!sentInd.length) {
      return { ok: false, error: 'An indicative must be sent to the applicant before an offer can be sent.' };
    }
    const full = await getById(id);
    const missing = full ? checkOffer(full) : [];
    if (missing.length) return { ok: false, error: 'Complete these before sending the offer', missing };
  }
  await db.query(
    `UPDATE enquiries SET offer_amount = @p1, offer_rate = @p2, offer_valid_until = @p3, offer_notes = @p4,
        offer_sent_at = ${send ? 'COALESCE(offer_sent_at, SYSUTCDATETIME())' : 'offer_sent_at'},
        updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0`,
    [id, amt, rate, valid, notes, req && req.userData ? req.userData.userId : null],
  );
  if (send) {
    const res = await workflow.applyStatus(id, workflow.S.QUALIFIED, req, { reason: 'Offer Sent' });
    if (!res.ok) return { ok: false, error: res.error };
  }
  return { ok: true };
}

async function create(body, req, { source = 'manual' } = {}) {
  // Staff (manual drawer) creation enforces the same `*` fields the Angular
  // form does. Every OTHER intake stays light: the website form and the Outlook
  // email intake cannot know branch / product / amount / term / property, so
  // holding them to the staff rules rejected every inbound email enquiry.
  const staff = source === 'manual';
  const { values, errors: fieldErrors } = validate(body, { staff });
  // Validate the applicant rows in the SAME pass, so the caller gets every
  // problem at once instead of fixing the enquiry only to fail on an applicant.
  const errors = { ...fieldErrors, ...validateApplicants(body && body.applicants, { staff }) };
  // Company name is no longer required for a Company enquiry (borrower details optional).
  const mapErr = checkMapLink(values.map_link);
  if (mapErr) errors.map_link = mapErr;
  const drawdownsJson = cleanDrawdowns(body && body.drawdowns, errors);
  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  if (values.charge_type !== '2nd') values.charge_amount = null;
  normRep(values);
  await applyBorrowerSolicitor(values);
  const addSecs = cleanSecurityRows(Array.isArray(body.additional_securities) ? body.additional_securities : []);
  // Client 15-10-2026: ltv_pct = OUR loan's LTV; total_ltv_pct = incl. other charges (utils/ltv).
  { const lp = ltvPair(values.amount_requested, [values, ...addSecs]); values.ltv_pct = lp.our; values.total_ltv_pct = lp.total; }
  if (drawdownsJson !== undefined) values.drawdowns = drawdownsJson;
  if (values.drawdowns_required === 0) values.drawdowns = null;
  const ref = await generateRef();
  const assignedTo = values.assigned_to || null;
  const startCode = assignedTo ? workflow.S.ASSIGNED : workflow.S.NEW;
  const statusId = await workflow.idOf(startCode);

  const cols = { ...values, enquiry_ref: ref, enquiry_status_id: statusId };
  cols.created_by = req && req.userData ? req.userData.userId : null;
  // Step 5 "other securities" — flexible list stored as JSON.
  if (addSecs.length) {
    cols.additional_securities = JSON.stringify(addSecs);
  }

  const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
  const params = keys.map((k) => cols[k]);
  const ph = keys.map((_, i) => '@p' + i).join(', ');
  const out = await db.query(
    `INSERT INTO enquiries (${keys.join(', ')}) OUTPUT INSERTED.enquiry_id AS id VALUES (${ph})`,
    params,
  );
  const id = out[0].id;

  if (Array.isArray(body.applicants)) await saveApplicants(id, body.applicants, req);

  if (assignedTo) {
    await db.query(
      `INSERT INTO enquiry_assignments (enquiry_id, assigned_to, previous_assigned_to, assigned_by, note)
       VALUES (@p0, @p1, NULL, @p2, @p3)`,
      [id, assignedTo, req && req.userData ? req.userData.userId : null, 'Assigned on creation'],
    );
  }

  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_CREATE', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { ref, source },
  }));
  await notify.enquiryCreated({
    enquiryId: id, ref, assignedTo, source,
    actorId: req && req.userData ? req.userData.userId : null,
  });
  return { ok: true, id, ref };
}

async function update(id, body, req) {
  const exists = await db.query('SELECT 1 FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { ok: false, notFound: true };

  const { ok, errors, values } = validate(body, { partial: true });
  const applicantErrors = validateApplicants(body && body.applicants);
  if ('map_link' in values) { const mErr = checkMapLink(values.map_link); if (mErr) applicantErrors.map_link = mErr; }
  const drawdownsJson = cleanDrawdowns(body && body.drawdowns, applicantErrors);
  if (drawdownsJson !== undefined) values.drawdowns = drawdownsJson;
  if (values.drawdowns_required === 0) values.drawdowns = null;
  if (!ok || Object.keys(applicantErrors).length) {
    return { ok: false, errors: { ...errors, ...applicantErrors } };
  }
  // Only saved once BOTH the enquiry and every applicant row have passed - a
  // half-written update used to be possible when the enquiry failed afterwards.
  if (Array.isArray(body.applicants)) await saveApplicants(id, body.applicants, req);
  // Step 5 "other securities" — flexible list stored as JSON (mirrors create()).
  if (Array.isArray(body.additional_securities)) {
    const rows = cleanSecurityRows(body.additional_securities);
    values.additional_securities = rows.length ? JSON.stringify(rows) : null;
  }
  if ('charge_type' in values && values.charge_type !== '2nd') values.charge_amount = null;
  normRep(values);
  await applyBorrowerSolicitor(values);
  // assignment is changed via assign(); ignore assigned_to here to keep history intact
  delete values.assigned_to;
  // Recompute the stored combined LTV whenever anything it depends on is touched
  // (main security OR the other securities list).
  const LTV_KEYS = ['amount_requested', 'estimated_value', 'outstanding_loan', 'charge_type', 'charge_amount', 'additional_securities'];
  if (LTV_KEYS.some((k) => k in values)) {
    const cur = await db.query(
      'SELECT amount_requested, estimated_value, outstanding_loan, charge_type, charge_amount, additional_securities FROM enquiries WHERE enquiry_id = @p0',
      [id],
    );
    const base = cur[0] || {};
    const pick = (k) => (k in values ? values[k] : base[k]);
    let secs = pick('additional_securities');
    try { secs = secs ? JSON.parse(secs) : []; } catch (_) { secs = []; }
    const main = {
      amount_requested: pick('amount_requested'), estimated_value: pick('estimated_value'),
      outstanding_loan: pick('outstanding_loan'), charge_type: pick('charge_type'), charge_amount: pick('charge_amount'),
    };
    // Client 15-10-2026: ltv_pct = OUR loan's LTV; total_ltv_pct = incl. other charges (utils/ltv).
    const lp = ltvPair(main.amount_requested, [main, ...(Array.isArray(secs) ? secs : [])]);
    values.ltv_pct = lp.our; values.total_ltv_pct = lp.total;
  }
  const keys = Object.keys(values);
  if (!keys.length) {
    if (Array.isArray(body.applicants)) {
      await audit.write(audit.fromReq(req, {
        action: 'ENQUIRY_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
        details: { fields: ['applicants'] },
      }));
    }
    return { ok: true, id };
  }

  const setSql = keys.map((c, i) => `${c} = @p${i}`).join(', ');
  const params = keys.map((c) => values[c]);
  params.push(req && req.userData ? req.userData.userId : null);
  params.push(id);
  await db.query(
    `UPDATE enquiries SET ${setSql}, updated_by = @p${keys.length}, updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p${keys.length + 1}`,
    params,
  );
  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_UPDATE', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { fields: keys },
  }));
  return { ok: true, id };
}

async function assign(id, body, req) {
  const newOwner = int(body.assigned_to);
  if (!newOwner) return { ok: false, errors: { assigned_to: 'A valid BDM is required' } };

  const rows = await db.query(
    `SELECT e.assigned_to, e.enquiry_ref, st.code AS status_code
       FROM enquiries e LEFT JOIN enquiry_statuses st ON st.enquiry_status_id = e.enquiry_status_id
      WHERE e.enquiry_id = @p0 AND e.flag_deleted = 0`, [id]);
  if (!rows.length) return { ok: false, notFound: true };
  const prev = rows[0].assigned_to || null;
  const ref = rows[0].enquiry_ref || null;
  const curStatus = String(rows[0].status_code || '').toUpperCase();
  // A finished enquiry cannot be reassigned.
  if (['CONVERTED', 'LOST', 'CLOSED'].includes(curStatus)) {
    return { ok: false, errors: { assigned_to: 'This enquiry is ' + curStatus.toLowerCase() + ' and can no longer be reassigned.' } };
  }

  const validUser = await db.query(
    'SELECT 1 FROM users WHERE user_id = @p0 AND flag_deleted = 0 AND is_active = 1', [newOwner]);
  if (!validUser.length) return { ok: false, errors: { assigned_to: 'User not found or inactive' } };

  await db.query(
    `INSERT INTO enquiry_assignments (enquiry_id, assigned_to, previous_assigned_to, assigned_by, note)
     VALUES (@p0, @p1, @p2, @p3, @p4)`,
    [id, newOwner, prev, req && req.userData ? req.userData.userId : null, body.note ? String(body.note).slice(0, 500) : null],
  );
  await db.query(
    'UPDATE enquiries SET assigned_to = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE enquiry_id = @p0',
    [id, newOwner, req && req.userData ? req.userData.userId : null],
  );
  // move to ASSIGNED only from an early stage (NEW / UNASSIGNED / or already ASSIGNED).
  // A progressed enquiry (Contacted … Qualified / Offer Accepted) keeps its status — the
  // reassignment just changes the owner, it must not drag the enquiry backward.
  if (['', 'NEW', 'UNASSIGNED', 'ASSIGNED'].includes(curStatus)) {
    await workflow.applyStatus(id, workflow.S.ASSIGNED, req, { force: true, reason: 'Assignment' });
  }

  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_ASSIGN', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { previous_owner: prev, new_owner: newOwner },
  }));
  await notify.enquiryAssigned({
    enquiryId: id, ref, newOwner,
    actorId: req && req.userData ? req.userData.userId : null,
  });
  return { ok: true, id, previous_owner: prev, new_owner: newOwner };
}

async function changeStatus(id, toCode, req, reason) {
  // super-admins may override the transition guard (backward moves, re-open)
  const force = !!(req && req.userData && req.userData.isSuperAdmin);
  const res = await workflow.applyStatus(id, toCode, req, { reason, force });
  if (res && res.ok) {
    const own = await db.query(
      'SELECT assigned_to, enquiry_ref FROM enquiries WHERE enquiry_id = @p0', [id]);
    const row = own[0] || {};
    await notify.enquiryStatusChanged({
      enquiryId: id, ref: row.enquiry_ref || null, toCode: res.code, statusName: res.code,
      assignedTo: row.assigned_to || null,
      actorId: req && req.userData ? req.userData.userId : null,
    });
  }
  return res;
}

async function listNotes(id) {
  return db.query(
    `SELECT n.note_id, n.note, n.created_by, u.full_name AS created_by_name, n.created_at
       FROM enquiry_notes n LEFT JOIN users u ON u.user_id = n.created_by
      WHERE n.enquiry_id = @p0 ORDER BY n.created_at DESC`,
    [id],
  );
}

async function addNote(id, note, req) {
  const text = String(note || '').trim();
  if (!text) return { ok: false, errors: { note: 'Note text is required' } };
  const exists = await db.query('SELECT 1 FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0', [id]);
  if (!exists.length) return { ok: false, notFound: true };
  const out = await db.query(
    `INSERT INTO enquiry_notes (enquiry_id, note, created_by) OUTPUT INSERTED.note_id AS id VALUES (@p0, @p1, @p2)`,
    [id, text.slice(0, 4000), req && req.userData ? req.userData.userId : null],
  );
  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_NOTE_ADD', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
  }));
  return { ok: true, id: out[0].id };
}

/** Run the configurable convert rule set. Returns missing [{field,label}]. */
function checkRules(enquiry, rules) {
  const missing = [];
  for (const rule of rules) {
    const pass = typeof rule.check === 'function'
      ? !!rule.check(enquiry)
      : enquiry[rule.field] !== null && enquiry[rule.field] !== undefined && enquiry[rule.field] !== '';
    if (!pass) missing.push({ field: rule.field, label: rule.label });
  }
  return missing;
}

function checkOffer(enquiry) { return checkRules(enquiry, CFG.OFFER_RULES); }

function checkConvert(enquiry) {
  const missing = [];
  for (const rule of CFG.CONVERT_RULES) {
    const pass = typeof rule.check === 'function'
      ? !!rule.check(enquiry)
      : enquiry[rule.field] !== null && enquiry[rule.field] !== undefined && enquiry[rule.field] !== '';
    if (!pass) missing.push({ field: rule.field, label: rule.label });
  }
  return missing;
}

/**
 * The gross loan the application should start from, in priority order:
 *   1. the ACCEPTED official offer version (enquiry_offers.offer_json.gross_loan_amount)
 *   2. the most recent SENT official offer version
 *   3. enquiries.offer_amount - the figure typed in the quick "Send Offer" popup,
 *      which writes to the enquiry row and never creates an enquiry_offers version
 *   4. the most recent SENT indicative's Total Gross Loan incl DDs
 *   5. the most recent indicative of ANY status (saved but not emailed yet)
 *   6. the amount the enquiry was raised for (amount_requested)
 * Point 3 of Ramiz's 23-09 list: converting must carry the agreed figure, not
 * the original ask, which is usually a round number typed at enquiry time.
 */
/* ---- agreed terms pack: the figures the application inherits on convert ---- */
const nn = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
function normDrawdowns(list) {
  return (Array.isArray(list) ? list : [])
    .map((d, i) => ({
      seq: i + 1,
      month: nn(d && d.month),
      gross: nn(d && (d.gross != null ? d.gross : d.amount)),
      net: nn(d && d.net),
    }))
    .filter((d) => (d.gross || 0) > 0 || (d.net || 0) > 0);
}
function normSecurities(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && x.include !== false && (x.address || x.description || nn(x.value) || nn(x.estimated_value)))
    .map((x) => ({
      address: String(x.address || x.description || '').trim(),
      security_type: String(x.security_type || '').trim(),
      value: nn(x.value != null ? x.value : x.estimated_value),
      existing_charge: nn(x.existing_charge),
      // Charge picked on the enquiry's Security tab ('1st' / '2nd') - kept so the
      // application / underwriting rows carry it instead of guessing from figures.
      charge_type: x.charge_type ? String(x.charge_type).trim() : null,
    }));
}
function termsPackFromOffer(o) {
  const itype = o.interest_type || null;
  return {
    interest_type: itype,
    arrangement_fee: nn(o.arrangement_fee),
    document_fee: nn(o.document_fee),
    // Client 12-10-2026: the AGREED OFFER TERMS Broker Fee shows the ACTUAL broker fee
    // entered on the indicative (broker_fee_base) — exactly what was entered, same as the
    // offer letter's "Less broker fee" line. The arrangement-fee SHARE paid to the broker
    // (broker_fee_amount) is carried separately so the Arrangement Fee line can show
    // "(of which £X is payable to <broker>)", mirroring loan_offer.pdf.
    broker_fee: nn(o.broker_fee_base),
    broker_fee_amount: nn(o.broker_fee_amount),
    broker_fee_is_pct: o.broker_fee_is_pct !== false,
    broker_fee_value: nn(o.broker_fee_value),
    broker_payee_name: o.broker_payee_name || null,
    net_release_day1: nn(o.net_release_day1),
    interest_total: nn(itype === 'Serviced' ? o.serviced_interest : (o.retained_interest != null ? o.retained_interest : o.rolled_up_interest)),
    monthly_payment: nn(o.monthly_payment),
    redemption_total: nn(o.redemption_total),
    drawdowns: normDrawdowns(o.drawdowns),
    drawdowns_total: nn(o.drawdowns_total),
    drawdowns_net_total: nn(o.drawdowns_net_total),
    net_release_incl_drawdowns: nn(o.net_release_incl_drawdowns),
    main_property_value: nn(o.main_property_value),
    total_security_value: nn(o.assumed_asset_value),
    ltv_pct: nn(o.ltv_pct),
    max_ltv: nn(o.max_ltv),
    security_charge_type: o.security_charge_type || null,
    additional_securities: normSecurities(o.additional_securities),
  };
}
function termsPackFromCalc(c, inp) {
  const itype = c.interest_type || inp.interest_type || null;
  const brokerIsPct = !(c.broker_fee_is_pct === false || c.broker_fee_is_pct === 'false');
  return {
    interest_type: itype,
    arrangement_fee: nn(c.arrangement_fee),
    document_fee: nn(c.document_fee),
    broker_fee: nn(c.broker_fee),
    broker_fee_is_pct: brokerIsPct,
    broker_fee_value: brokerIsPct ? nn(c.broker_fee_pct) : nn(c.broker_fee),
    broker_payee_name: null,
    net_release_day1: nn(c.day1_net != null ? c.day1_net : c.total_net),
    interest_total: nn(c.serviced_interest_total != null ? c.serviced_interest_total : (c.retained_interest_total != null ? c.retained_interest_total : c.rolled_up_interest)),
    monthly_payment: nn(c.monthly_payment),
    redemption_total: nn(c.redemption_total),
    drawdowns: normDrawdowns(Array.isArray(c.drawdowns) && c.drawdowns.length ? c.drawdowns : inp.drawdowns),
    drawdowns_total: nn(c.drawdowns_total),
    drawdowns_net_total: nn(c.drawdowns_net_total),
    net_release_incl_drawdowns: nn(c.total_net_incl_drawdowns),
    main_property_value: nn(c.main_property_value != null ? c.main_property_value : c.property_value),
    total_security_value: nn(c.total_security_value != null ? c.total_security_value : c.property_value),
    ltv_pct: nn(c.ltv_pct),
    max_ltv: nn(c.max_ltv),
    security_charge_type: (c.calc_type === 'second_charge' && Number(c.main_first_charge != null ? c.main_first_charge : c.first_charge) > 0) ? '2nd legal charge' : '1st legal charge',
    additional_securities: normSecurities(c.additional_securities),
  };
}
/** Enquiry-only fallback (no offer / indicative): drawdowns and securities as captured. */
function termsPackFromEnquiry(enquiry) {
  let dds = enquiry.drawdowns;
  if (typeof dds === 'string') { try { dds = JSON.parse(dds); } catch (_) { dds = []; } }
  return {
    interest_type: enquiry.interest_type || null,
    drawdowns: normDrawdowns(dds),
    additional_securities: normSecurities(enquiry.additional_securities),
  };
}

/** LTV% shown on the accepted offer's indicative (impliedLtvPct). Used so the
 *  application inherits the SAME LTV the client saw, not a recompute. */
async function indicativeLtv(indId, enqId) {
  const pj = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  try {
    let rows = [];
    if (indId) rows = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [indId, enqId]);
    if (!rows.length) rows = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY CASE WHEN status = 'Sent' THEN 0 ELSE 1 END, version_no DESC`, [enqId]);
    if (rows.length) { const c = pj(rows[0].calc_json) || {}; return pos(c.ltv_pct); }
  } catch (e) { console.error('[convert] indicativeLtv failed: ' + e.message); }
  return null;
}

/** Security / property value from the linked (or latest) indicative — for the Credit
 *  Deal Summary LTV, which must use the INDICATIVE's security value, not the enquiry's
 *  estimated value (client 09-10-2026). */
async function indicativeSecurityValue(indId, enqId) {
  const pj = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  try {
    let rows = [];
    if (indId) rows = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [indId, enqId]);
    if (!rows.length) rows = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY CASE WHEN status = 'Sent' THEN 0 ELSE 1 END, version_no DESC`, [enqId]);
    if (rows.length) {
      const c = pj(rows[0].calc_json) || {};
      return {
        total_security_value: pos(c.total_security_value != null ? c.total_security_value : c.property_value),
        main_property_value: pos(c.main_property_value != null ? c.main_property_value : c.property_value),
        ltv_pct: pos(c.ltv_pct),
        max_ltv: pos(c.max_ltv),
      };
    }
  } catch (e) { console.error('[convert] indicativeSecurityValue failed: ' + e.message); }
  return null;
}

/**
 * Gross / term / LTV of the latest Accepted (else Sent) offer, for the enquiry header
 * strip (client 15-10-2026). Null when no offer has gone out.
 * LTV: the offer's own ltv_pct when stored; else re-derived from the linked indicative's
 * security figures for the OFFER gross (the gross can be edited at Send Offer, so the
 * indicative's % alone could be stale): net model -> gross / net value; otherwise
 * (gross + charges ahead) / total security value. Falls back to the indicative's %.
 */
async function currentOfferTerms(id, enquiry = null) {
  const pj = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const rows = await db.query(
    `SELECT TOP 1 status, version_no, offer_json, sent_at FROM enquiry_offers
      WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status IN ('Accepted', 'Sent')
      ORDER BY CASE WHEN status = 'Accepted' THEN 0 ELSE 1 END, version_no DESC`, [id]);
  if (!rows.length) return null;
  const o = pj(rows[0].offer_json) || {};
  const gross = pos(o.gross_loan_amount);
  if (gross === null) return null;
  // Client 15-10-2026: OUR loan's LTV (offer gross ÷ security value) + the total incl.
  // other charges, same rule as everywhere else (utils/ltv).
  // Client 15-10-2026 (2): once an offer is sent the header LTV follows the offer /
  // its indicative (offer gross ÷ the property value the indicative used), NOT gross ÷
  // the enquiry's security values (that is the Est. LTV from New Enquiry).
  // Client 16-10-2026: the offer's LTV = its own ltv_pct, else the LTV of the indicative it
  // came from (what was entered in the calculator). Est. LTV from the securities is only
  // the last fallback. No separate "total LTV".
  let ltv = pos(o.ltv_pct); const totalLtv = null;
  if (ltv === null) ltv = await indicativeLtv(o.indicative_id, id);
  let lp = null;
  if (ltv === null && enquiry) {
    lp = ltvPair(gross, [enquiry, ...(Array.isArray(enquiry.additional_securities) ? enquiry.additional_securities : [])]);
    ltv = lp.our;
  }
  if (ltv === null) {
    let c = {};
    try {
      let ind = [];
      if (o.indicative_id) ind = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [o.indicative_id, id]);
      if (!ind.length) ind = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY CASE WHEN status = 'Sent' THEN 0 ELSE 1 END, version_no DESC`, [id]);
      c = ind.length ? (pj(ind[0].calc_json) || {}) : {};
    } catch (_) { c = {}; }
    const netVal = c.value_model === 'net' ? pos(c.net_property_value) : null;
    const secVal = pos(c.total_security_value != null ? c.total_security_value : c.property_value) || pos(o.assumed_asset_value);
    // Client 17-10-2026: LTV = our loan only (the charges ahead are in Total LTV).
    if (netVal !== null) ltv = r2((gross / netVal) * 100);
    else if (secVal !== null) ltv = r2((gross / secVal) * 100);
    else if (lp && lp.our != null) ltv = lp.our;
    else ltv = pos(c.ltv_pct);
  }
  return {
    gross_loan_amount: gross,
    term_months: pos(o.term_months),
    ltv_pct: ltv,
    total_ltv_pct: totalLtv,
    status: rows[0].status,
    version_no: rows[0].version_no,
    source: `${rows[0].status} Offer v${rows[0].version_no}`,
  };
}

async function agreedTerms(id, enquiry) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const fromJson = (raw, key) => {
    if (!raw) return null;
    try { return num(JSON.parse(raw)[key]); } catch (e) { return null; }
  };
  const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  const eTerm = num(enquiry && enquiry.term_months);
  const eRate = num(enquiry && enquiry.offer_rate);
  const fallback = {
    value: num(enquiry && enquiry.amount_requested), term: eTerm, ratePct: eRate,
    source: 'enquiry amount requested',
  };
  try {
    const offers = await db.query(
      // Client 22-10-2026: convert carries the LATEST offer version (highest version_no that
      // is still live - Draft / Sent / Accepted), not an older sent / accepted one.
      `SELECT TOP 2 status, version_no, offer_json FROM enquiry_offers
         WHERE enquiry_id = @p0 AND flag_deleted = 0 AND status NOT IN ('Superseded', 'Withdrawn')
         ORDER BY version_no DESC`, [id]);
    for (const row of offers) {
      const o = parseJson(row.offer_json) || {};
      const v = num(o.gross_loan_amount);
      if (v !== null) {
        const offLtv = num(o.ltv_pct) !== null ? num(o.ltv_pct) : await indicativeLtv(o.indicative_id, id);
        const offPack = termsPackFromOffer(o);
        // Client 09-10-2026: the Credit Deal Summary LTV must use the INDICATIVE's security
        // value. Offers don't always carry it, so backfill from the linked indicative.
        if (!offPack.total_security_value || !offPack.main_property_value) {
          const sv = await indicativeSecurityValue(o.indicative_id, id);
          if (sv) {
            if (!offPack.total_security_value) offPack.total_security_value = sv.total_security_value;
            if (!offPack.main_property_value) offPack.main_property_value = sv.main_property_value;
            if (!offPack.ltv_pct) offPack.ltv_pct = sv.ltv_pct;
            if (!offPack.max_ltv) offPack.max_ltv = sv.max_ltv;
          }
        }
        return {
          value: v, term: num(o.term_months) || eTerm, ratePct: num(o.monthly_rate_pct) || eRate,
          ltvPct: offLtv,
          source: `${row.status} Offer v${row.version_no}`,
          pack: offPack,
        };
      }
    }
    const quick = num(enquiry && enquiry.offer_amount);
    if (quick !== null) return { value: quick, term: eTerm, ratePct: eRate, source: 'offer amount on the enquiry' };

    const inds = await db.query(
      `SELECT TOP 5 status, version_no, calc_json, inputs_json FROM enquiry_indicatives
         WHERE enquiry_id = @p0 AND flag_deleted = 0
         ORDER BY version_no DESC`, [id]);
    for (const row of inds) {
      const c = parseJson(row.calc_json) || {};
      const inp = parseJson(row.inputs_json) || {};
      const v = num(c.total_gross_loan_incl_dds);
      if (v !== null) {
        return {
          value: v,
          term: num(c.term_months) || num(inp.term_months) || eTerm,
          ratePct: num(c.retained_interest_day1_rate_pct) || num(inp.monthly_rate_pct) || eRate,
          ltvPct: num(c.ltv_pct),
          source: `${row.status} Indicative v${row.version_no}`,
          pack: termsPackFromCalc(c, inp),
        };
      }
    }
  } catch (e) {
    // Never block a conversion because the history could not be read - but say so
    // loudly on the API console: a silent catch here is why this looked like a
    // no-op the first two times.
    console.error('[convert] agreedTerms failed for enquiry ' + id + ': ' + e.message);
  }
  return fallback;
}

/**
 * Write the agreed terms onto a (new or already converted) application:
 * fee columns, broker fee, the agreed_terms JSON snapshot (drawdowns etc.) and one
 * application_security row per other security. Safe to re-run: extra security rows
 * it added before (marked added_value = 'OTHER_SECURITY') are replaced.
 */
async function applyAgreedTerms(applicationId, enquiry, gross, grossAmount, ratePct, uid, opts = {}) {
  const fb = termsPackFromEnquiry(enquiry);
  const p = { ...fb, ...(gross && gross.pack ? gross.pack : {}) };
  if (!p.drawdowns || !p.drawdowns.length) p.drawdowns = fb.drawdowns;
  if (!p.additional_securities || !p.additional_securities.length) p.additional_securities = fb.additional_securities;
  if (!p.broker_payee_name) p.broker_payee_name = enquiry.broker_company || enquiry.broker_name || enquiry.broker_name_text || null;
  const g = Number(grossAmount) || 0;
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const arrPct = p.arrangement_fee != null && g > 0 ? Math.round((p.arrangement_fee / g) * 100 * 10000) / 10000 : null;
  // Letter: "exit charge ... equivalent to 1 months interest".
  const exitFee = ratePct != null && g > 0 ? r2(g * ratePct / 100) : null;
  const snapshot = { source: gross ? gross.source : null, gross_loan_amount: grossAmount, monthly_rate_pct: ratePct, exit_fee: exitFee, ltv_pct: (gross && gross.ltvPct != null ? gross.ltvPct : null), ...p };

  await db.query(
    `UPDATE applications SET
        arrangement_fee_pct = CASE WHEN @p9 = 1 THEN COALESCE(arrangement_fee_pct, @p1) ELSE COALESCE(@p1, arrangement_fee_pct) END,
        doc_fee             = CASE WHEN @p9 = 1 THEN COALESCE(doc_fee, @p2) ELSE COALESCE(@p2, doc_fee) END,
        net_advance         = CASE WHEN @p9 = 1 THEN COALESCE(net_advance, @p3) ELSE COALESCE(@p3, net_advance) END,
        rolled_interest     = CASE WHEN @p9 = 1 THEN COALESCE(rolled_interest, @p4) ELSE COALESCE(@p4, rolled_interest) END,
        gross_redemption    = CASE WHEN @p9 = 1 THEN COALESCE(gross_redemption, @p5) ELSE COALESCE(@p5, gross_redemption) END,
        introducer_fee      = CASE WHEN @p9 = 1 THEN COALESCE(introducer_fee, @p6) ELSE COALESCE(@p6, introducer_fee) END,
        exit_fee            = COALESCE(exit_fee, @p7),
        agreed_terms        = @p8
      WHERE application_id = @p0`,
    [applicationId, arrPct, r2(p.document_fee), r2(p.net_release_day1), r2(p.interest_total),
     r2(p.redemption_total), r2(p.broker_fee), exitFee, JSON.stringify(snapshot), opts.fillOnly ? 1 : 0],
  );

  if (p.security_charge_type) {
    await db.query(
      `UPDATE application_security SET charge_type = COALESCE(charge_type, @p1)
        WHERE security_id = (SELECT TOP 1 security_id FROM application_security
                              WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id)`,
      [applicationId, p.security_charge_type]);
  }
  await db.query(
    `DELETE FROM application_security WHERE application_id = @p0 AND added_value = 'OTHER_SECURITY'`, [applicationId]);
  // Charge for each other security: the one selected on the enquiry wins (1st / 2nd).
  // The offer / indicative packs may not carry it, so look it up on the enquiry's own
  // additional_securities by address; only fall back to the old existing-charge guess
  // when nothing was selected anywhere.
  let enqSecs = enquiry && enquiry.additional_securities;
  if (typeof enqSecs === 'string') { try { enqSecs = JSON.parse(enqSecs); } catch (_) { enqSecs = []; } }
  const addrKey = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const chgSel = (ct) => { const s = String(ct || '').trim().toLowerCase(); return s.startsWith('2nd') ? '2nd' : (s.startsWith('1st') ? '1st' : ''); };
  const enqCharge = new Map();
  const enqRow = new Map();
  for (const r of (Array.isArray(enqSecs) ? enqSecs : [])) {
    const k = addrKey(r && (r.address || r.description));
    if (k && !enqRow.has(k)) enqRow.set(k, r);
    if (k && !enqCharge.has(k) && chgSel(r.charge_type)) enqCharge.set(k, chgSel(r.charge_type));
  }
  // Stored as '1st' / '2nd' - same values as the main security, the enquiry and the
  // application Security edit dropdown (Charge Amount etc. key off === '2nd').
  const chargeLabel = (x) => {
    const ct = chgSel(x.charge_type) || enqCharge.get(addrKey(x.address)) || '';
    if (ct) return ct;
    return (x.existing_charge || 0) > 0 ? '2nd' : '1st';
  };
  // Client 15-10-2026: an other security is carried over with the SAME details the
  // enquiry captured (postcode, tenure, purchase, ...) and - for a 2nd charge - the amount
  // of the charge ahead of us. Previously only address / value / charge were copied, so a
  // 2nd-charge security looked like a plain 1st charge on the application.
  const nOrNull = (v) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
  const bOrNull = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'Yes' ? 1
    : (v === false || v === 0 || v === '0' || v === 'false' || v === 'No' ? 0 : null));
  const dOrNull = (v) => { const t = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
  const sOrNull = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
  for (const x of p.additional_securities || []) {
    const m = enqRow.get(addrKey(x.address)) || {};
    const ct = chargeLabel(x);
    const chargeAmt = ct === '2nd' ? (nOrNull(m.charge_amount) || nOrNull(x.charge_amount) || nOrNull(x.existing_charge)) : null;
    await db.query(
      `INSERT INTO application_security
         (application_id, property_address, postcode, property_type, tenure, tenure_years, charge_type, charge_amount,
          estimated_value, gdv, owns_property, purchase_price, purchase_date, outstanding_loan, repaid_on_completion,
          lender, map_link, added_value, created_by)
       VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16, 'OTHER_SECURITY', @p17)`,
      [applicationId, x.address || null, sOrNull(m.postcode || x.postcode, 20),
       sOrNull(m.property_type || x.security_type, 60), sOrNull(m.tenure, 30), nOrNull(m.tenure_years),
       ct, chargeAmt,
       x.value, nOrNull(m.gdv), bOrNull(m.owns_property), nOrNull(m.purchase_price), dOrNull(m.purchase_date),
       // existing charge on a 2nd charge now lives in charge_amount (not "outstanding loan")
       m.outstanding_loan != null && m.outstanding_loan !== '' ? nOrNull(m.outstanding_loan) : (ct === '2nd' ? null : nOrNull(x.existing_charge)),
       bOrNull(m.repaid_on_completion), sOrNull(m.lender, 150), sOrNull(m.map_link, 500), uid]);
  }
  return snapshot;
}

/**
 * Client 12-10-2026: push an EDITED indicative (underwriter changed it in Underwriting) onto the
 * application so underwriting + the portfolio follow the new figures. The offer normally wins in
 * agreedTerms(), so we write the indicative's figures directly here. Returns the key figures.
 */
async function applyIndicativeToApplication(applicationId, enquiry, calc, inputs, uid) {
  const c = calc || {};
  const inp = inputs || {};
  const nn = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pack = termsPackFromCalc(c, inp);
  const grossAmount = nn(c.total_gross_loan_incl_dds) != null ? nn(c.total_gross_loan_incl_dds)
    : (nn(c.base_gross) != null ? nn(c.base_gross) : nn(pack.arrangement_fee));
  const ratePct = nn(inp.monthly_rate_pct) != null ? nn(inp.monthly_rate_pct) : nn(c.retained_interest_day1_rate_pct);
  const term = nn(inp.term_months) != null ? nn(inp.term_months) : nn(c.term_months);
  // Client 20-10-2026: net_advance is the DAY 1 net (convert writes the offer's day-1 net and the
  // portfolio adds each drawdown's net on top) - writing the total incl. drawdowns here counted
  // the drawdowns twice. The headline Net Amount adds the drawdowns back (utils/loanAmount.js).
  const net = nn(c.day1_net) != null ? nn(c.day1_net) : nn(c.total_net);
  // Client 15-10-2026: OUR loan's LTV (gross ÷ security value) + total incl. other charges.
  const lp = ltvPair(grossAmount, [enquiry || {}, ...((enquiry && Array.isArray(enquiry.additional_securities)) ? enquiry.additional_securities : [])]);
  // Client 16-10-2026: the LTV is the one entered on the indicative (same rule as convert /
  // offer accept) - the enquiry's own security values gave 80.75% for a 65% indicative.
  // Recomputed from the enquiry securities only when the indicative carries none.
  const indLtv = nn(c.ltv_pct) != null && nn(c.ltv_pct) > 0 ? Math.round(nn(c.ltv_pct) * 100) / 100 : null;
  // Client 19-10-2026: the LTV % on the indicative is the TOTAL LTV; the application's LTV
  // (our loan only, from the enquiry) is left as it is.
  const ltvPct = indLtv != null ? indLtv : lp.total;
  // Fee columns + agreed_terms snapshot + security rows (overwrite mode).
  await applyAgreedTerms(applicationId, enquiry, { pack, source: 'Underwriter indicative edit', ltvPct }, grossAmount, ratePct, uid);
  await db.query('UPDATE applications SET total_ltv_pct = @p1 WHERE application_id = @p0', [applicationId, ltvPct]);
  // Headline figures the header / schedule read directly.
  await db.query(
    `UPDATE applications SET
        amount_requested = COALESCE(@p1, amount_requested),
        term_months      = COALESCE(@p2, term_months),
        monthly_fee_pct  = COALESCE(@p3, monthly_fee_pct),
        net_advance      = COALESCE(@p4, net_advance),
        updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE application_id = @p0`,
    [applicationId, grossAmount, term, ratePct, net, uid]);
  return { grossAmount, term, ratePct, net, ltvPct };
}

/** Save the signed offer + form (one file) as an application document and link it. */
async function saveSignedOffer(applicationId, fileName, buf, uid) {
  const fs = require('fs');
  const path = require('path');
  const DOC_DIR = path.join('uploads', 'application_documents');
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = Date.now() + '_' + fileName.replace(/[^\w.\-]+/g, '_');
  fs.writeFileSync(path.join(absDir, safe), buf);
  const t = await db.query(`SELECT TOP 1 document_type_id AS id FROM document_types WHERE code = 'SIGNED_OFFER'`);
  const out = await db.query(
    `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
     OUTPUT INSERTED.app_document_id AS id
     VALUES (@p0, @p1, @p2, @p3, 'Uploaded', 'v1', @p4, @p4)`,
    [applicationId, t.length ? t[0].id : null, fileName, path.join(DOC_DIR, safe), uid]);
  const docId = out[0] ? out[0].id : null;
  // signed_offer_doc_id = the first one; all of them carry the SIGNED_OFFER type.
  if (docId) await db.query('UPDATE applications SET signed_offer_doc_id = COALESCE(signed_offer_doc_id, @p1) WHERE application_id = @p0', [applicationId, docId]);
  return docId;
}

/**
 * One-off: fill agreed terms into applications converted before 28-09-2026.
 * Only touches applications with an enquiry and no agreed_terms yet.
 */
async function backfillAgreedTerms() {
  const apps = await db.query(
    `SELECT application_id, enquiry_id, amount_requested FROM applications
      WHERE flag_deleted = 0 AND enquiry_id IS NOT NULL AND agreed_terms IS NULL`);
  let done = 0;
  for (const a of apps) {
    try {
      const enquiry = await getById(a.enquiry_id);
      if (!enquiry) continue;
      const gross = await agreedTerms(a.enquiry_id, enquiry);
      await applyAgreedTerms(a.application_id, enquiry, gross, a.amount_requested || gross.value, gross.ratePct, null, { fillOnly: true });
      done += 1;
      console.log(`[backfill] application ${a.application_id} <- enquiry ${a.enquiry_id} (${gross.source})`);
    } catch (e) {
      console.error(`[backfill] application ${a.application_id} failed: ${e.message}`);
    }
  }
  return { checked: apps.length, updated: done };
}

async function convert(id, req) {
  const enquiry = await getById(id);
  if (!enquiry) return { ok: false, notFound: true };
  if (enquiry.converted_application_id) {
    return { ok: false, alreadyConverted: true, applicationId: enquiry.converted_application_id };
  }

  const missing = checkConvert(enquiry);
  if (missing.length) return { ok: false, missing };

  // Client 05-10-2026 (#15): an offer MUST have been sent before an enquiry can
  // be converted (or its offer accepted). Block the direct-convert shortcut.
  const offerAlreadySent = !!enquiry.offer_sent_at
    || ['QUALIFIED', 'OFFER_ACCEPTED'].includes(String(enquiry.status_code || '').toUpperCase());
  if (!offerAlreadySent) {
    const sentOfferRows = await db.query(
      `SELECT TOP 1 1 AS x FROM enquiry_offers
         WHERE enquiry_id = @p0 AND status IN ('Sent', 'Accepted') AND flag_deleted = 0`, [id]);
    if (!sentOfferRows.length) {
      return { ok: false, missing: [{ field: 'offer', label: 'Send an offer before converting the enquiry' }] };
    }
  }

  // Client 28-09-2026: the signed offer letter + completed application form (one
  // file) MUST be uploaded to convert. It is saved to the application's documents
  // and the underwriting review opens it first.
  // Several files allowed (28-09-2026): body.signed_offers = [{ file_name, content_base64 }];
  // the older single body.signed_offer is still accepted.
  const rawDocs = (req && req.body && Array.isArray(req.body.signed_offers)) ? req.body.signed_offers
    : ((req && req.body && req.body.signed_offer) ? [req.body.signed_offer] : []);
  const signedDocs = rawDocs.map((d) => ({
    name: String((d && d.file_name) || '').trim(),
    buf: d && d.content_base64 ? Buffer.from(String(d.content_base64).replace(/^data:[^;]+;base64,/, ''), 'base64') : null,
  })).filter((d) => d.name && d.buf && d.buf.length);
  if (!signedDocs.length) {
    return { ok: false, missing: [{ field: 'signed_offer', label: 'Upload the signed offer letter and application form' }] };
  }

  // Borrower's solicitor may have been edited in Masters since it was picked: refresh the
  // borrower_sol_* snapshot from the master so the application / credit paper get the latest.
  if (enquiry.borrower_solicitor_id && enquiry.rep_type !== 'dual') {
    try {
      const sv = { rep_type: enquiry.rep_type, borrower_solicitor_id: enquiry.borrower_solicitor_id };
      await applyBorrowerSolicitor(sv);
      if (sv.borrower_solicitor_id) {
        await db.query(
          `UPDATE enquiries SET borrower_sol_firm = @p1, borrower_sol_contact = @p2, borrower_sol_address = @p3,
                  borrower_sol_telephone = @p4, borrower_sol_email = @p5 WHERE enquiry_id = @p0`,
          [id, sv.borrower_sol_firm, sv.borrower_sol_contact, sv.borrower_sol_address, sv.borrower_sol_telephone, sv.borrower_sol_email]);
        BORROWER_SOL_COLS.forEach((c) => { enquiry[c] = sv[c]; });
      }
    } catch (e) { console.error('[convert] borrower solicitor refresh failed: ' + e.message); }
  }

  // Client 15-10-2026: the four optional credit-paper notes are typed on the Convert popup
  // (not the New Enquiry form). Saved on the enquiry so the Credit Deal Summary sent below
  // and the Credit Paper generated later both print them. Blank boxes keep any old value.
  {
    const notes = (req && req.body && req.body.credit_notes && typeof req.body.credit_notes === 'object') ? req.body.credit_notes : {};
    const NOTE_KEYS = ['deal_appraisal', 'exit_strategy', 'risk_mitigants', 'credit_recommendation'];
    const vals = NOTE_KEYS.map((k) => { const v = String(notes[k] == null ? '' : notes[k]).trim().slice(0, 4000); return v || null; });
    if (vals.some((v) => v !== null)) {
      await db.query(
        `UPDATE enquiries SET deal_appraisal = COALESCE(@p1, deal_appraisal), exit_strategy = COALESCE(@p2, exit_strategy),
                risk_mitigants = COALESCE(@p3, risk_mitigants), credit_recommendation = COALESCE(@p4, credit_recommendation),
                updated_at = SYSUTCDATETIME()
          WHERE enquiry_id = @p0`, [id, ...vals]);
      NOTE_KEYS.forEach((k, i) => { if (vals[i] !== null) enquiry[k] = vals[i]; });
    }
  }

  // Gross amount carried into the application = accepted offer / sent offer /
  // quick offer amount / indicative, falling back to the enquiry's amount_requested.
  const gross = await agreedTerms(id, enquiry);
  const grossAmount = gross.value;
  // Term and monthly rate travel with the gross, so underwriting and the
  // portfolio schedule are all built from the accepted offer's figures.
  const termMonths = gross.term != null ? gross.term : enquiry.term_months;
  const ratePct = gross.ratePct;
  console.log(`[convert] enquiry ${id}: gross ${grossAmount}, term ${termMonths}, rate ${ratePct} from ${gross.source}`
    + ` (enquiry amount_requested ${enquiry.amount_requested}, term ${enquiry.term_months})`);

  const appRef = await generateAppRef();
  const statusRow = await db.query(
    `SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code = 'DRAFT' AND flag_deleted = 0`);
  const draftStatusId = statusRow.length ? statusRow[0].id : null;

  const out = await db.query(
    `INSERT INTO applications
       (application_ref, enquiry_id, branch_id, product_id, loan_purpose_id,
        application_status_id, application_source_id, broker_id, amount_requested,
        term_months, assigned_to, created_by)
     OUTPUT INSERTED.application_id AS id
     VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11)`,
    [
      appRef, id, enquiry.branch_id, enquiry.product_id, enquiry.loan_purpose_id,
      draftStatusId, enquiry.application_source_id, enquiry.broker_id, grossAmount,
      termMonths, enquiry.assigned_to, req && req.userData ? req.userData.userId : null,
    ],
  );
  const applicationId = out[0].id;

  // ---- carry the enquiry snapshot into the new application (so the Applicant,
  //      Security and Summary tabs are populated immediately after conversion) ----
  try {
    const isCompany = !!(enquiry.company_name && String(enquiry.company_name).trim());
    const uid = req && req.userData ? req.userData.userId : null;
    const splitName = (full) => {
      const f = String(full || '').trim();
      const sp = f.indexOf(' ');
      return { first: sp > 0 ? f.slice(0, sp) : (f || null), last: sp > 0 ? f.slice(sp + 1) : null };
    };
    // Use the captured enquiry applicant list (PDF section 4) when present, else the
    // single enquiry-level applicant. Each becomes an application applicant row.
    const srcApplicants = Array.isArray(enquiry.applicants) && enquiry.applicants.length
      ? enquiry.applicants
      : [{ full_name: enquiry.applicant_name, email: enquiry.email, mobile: enquiry.phone, dob: enquiry.dob, is_primary: 1 }];
    let first = true;
    for (const sa of srcApplicants) {
      // The FIRST source applicant is ALWAYS the Primary — guarantees exactly one
      // application_applicants row with role 'Primary' (what the list join reads).
      const primaryRow = first;
      let nm = splitName(sa.full_name);
      // Name guarantee: never leave an applicant fully blank. If this row has no
      // name and it is not a company primary, fall back to the enquiry-level
      // applicant name so the applications list/detail never shows "—".
      if (!nm.first && !nm.last && !(isCompany && primaryRow)) nm = splitName(enquiry.applicant_name);
      const ap = await db.query(
        `INSERT INTO applicants (applicant_type_id, first_name, last_name, company_name, company_reg_no, email, phone, dob, created_by)
         OUTPUT INSERTED.applicant_id AS id
         VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8)`,
        [
          enquiry.applicant_type_id || null, nm.first, nm.last,
          isCompany && primaryRow ? enquiry.company_name : null,
          isCompany && primaryRow ? (enquiry.company_reg_no || null) : null,
          sa.email || (primaryRow ? enquiry.email : null),
          sa.mobile || sa.phone || (primaryRow ? enquiry.phone : null),
          sa.dob || null, uid,
        ],
      );
      await db.query(
        `INSERT INTO application_applicants (application_id, applicant_id, applicant_role) VALUES (@p0, @p1, @p2)`,
        [applicationId, ap[0].id, primaryRow ? 'Primary' : 'Co-Applicant'],
      );
      first = false;
    }

    // security / property — carry the enquiry's whole property block across, so
    // the application is editable on its own from day one rather than showing
    // blanks the caseworker has to re-key from the enquiry screen.
    if ((enquiry.property_address && String(enquiry.property_address).trim()) || enquiry.estimated_value != null) {
      await db.query(
        `INSERT INTO application_security
           (application_id, property_address, postcode, property_type, tenure, tenure_years,
            charge_type, estimated_value, gdv, owns_property, purchase_price, purchase_date,
            outstanding_loan, repaid_on_completion, lender, added_value, map_link, created_by, charge_amount)
         VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16, @p17, @p18)`,
        [applicationId,
         enquiry.property_address || null,
         enquiry.postcode || null,
         enquiry.property_type || null,
         enquiry.tenure || null,
         enquiry.tenure_years != null ? enquiry.tenure_years : null,
         enquiry.charge_type || null,
         enquiry.estimated_value != null ? enquiry.estimated_value : null,
         enquiry.gdv != null ? enquiry.gdv : null,
         enquiry.owns_property != null ? enquiry.owns_property : null,
         enquiry.purchase_price != null ? enquiry.purchase_price : null,
         enquiry.purchase_date || null,
         enquiry.outstanding_loan != null ? enquiry.outstanding_loan : null,
         enquiry.repaid_on_completion != null ? enquiry.repaid_on_completion : null,
         enquiry.lender || null,
         enquiry.added_value || null,
         enquiry.map_link || null,
         req && req.userData ? req.userData.userId : null,
         // Client 15-10-2026: the 2nd-charge amount was not carried to the application.
         /^\s*2nd/i.test(String(enquiry.charge_type || '')) && enquiry.charge_amount != null ? enquiry.charge_amount : null],
      );
    }

    // ---- signed offer + application form upload ----
    for (const d of signedDocs) {
      try {
        await saveSignedOffer(applicationId, d.name, d.buf, uid);
      } catch (e) {
        console.error('[convert] signed document ' + d.name + ' not saved for application ' + applicationId + ': ' + e.message);
      }
    }

    // ---- agreed terms: fees, broker fee, drawdowns, other securities ----
    // (client 28-09-2026: "all the fees areas are empty, drawdowns not there")
    try {
      await applyAgreedTerms(applicationId, enquiry, gross, grossAmount, ratePct, uid);
    } catch (e) {
      console.error('[convert] agreed terms not copied for application ' + applicationId + ': ' + e.message);
    }

    // LTV + a starting KYC state so the tabs are meaningful from day one
    // #2/#11: the application LTV must match the ACCEPTED OFFER's LTV (what the
    // client saw on the indicative), not a fresh recompute. Fall back to the
    // computed loan LTV only when the offer carried none.
    // Client 15-10-2026: ONE rule everywhere - ltv_pct is OUR loan's LTV (agreed gross ÷
    // security value); the total incl. other charges is kept separately (utils/ltv). The
    // indicative's own % (which for a 2nd charge includes the charge ahead) is no longer used.
    // Client 19-10-2026 - same two figures as the enquiry screen (getById):
    //   LTV       = the enquiry's loan ÷ security values (our loan only, unchanged by any
    //               indicative / offer)
    //   Total LTV = the LTV % entered on the accepted / sent offer or indicative, else the
    //               enquiry's Total LTV (loan + other charges ÷ security values)
    const clampLtv = (v) => (v != null && v > 999.999 ? 999.999 : v);
    const ltv = clampLtv(enquiry.current_ltv_pct != null ? enquiry.current_ltv_pct
      : ltvPair(enquiry.amount_requested, [enquiry, ...(Array.isArray(enquiry.additional_securities) ? enquiry.additional_securities : [])]).our);
    const totalLtvPct = clampLtv(gross && gross.ltvPct != null ? gross.ltvPct : (enquiry.summary_total_ltv_pct ?? null));
    await db.query(`UPDATE applications SET total_ltv_pct = @p1 WHERE application_id = @p0`, [applicationId, totalLtvPct]);
    await db.query(
      `UPDATE applications SET ltv_pct = @p1, kyc_overall_status = 'Pending',
              kyc_identity_status = 'Pending', kyc_aml_status = 'Pending', kyc_pep_status = 'Pending',
              lead_source = @p2, broker_name = @p3, summary = @p4, requested_completion_date = @p5,
              monthly_fee_pct = COALESCE(@p6, monthly_fee_pct)
        WHERE application_id = @p0`,
      [applicationId, ltv,
       enquiry.lead_source || null,
       enquiry.broker_name_text || enquiry.broker_name || null,
       enquiry.summary || null,
       enquiry.requested_completion_date || null,
       // The agreed monthly rate drives the portfolio schedule's interest column.
       ratePct != null ? ratePct : null],
    );
  } catch (e) {
    // enrichment is best-effort — never block the conversion itself
    if (global.logger && global.logger.warn) global.logger.warn('convert enrichment failed: ' + e.message);
  }

  await db.query(
    `UPDATE enquiries SET converted_application_id = @p1, converted_at = SYSUTCDATETIME(),
            updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE enquiry_id = @p0`,
    [id, applicationId, req && req.userData ? req.userData.userId : null],
  );
  await workflow.applyStatus(id, workflow.S.CONVERTED, req, { force: true, reason: 'Converted to application ' + appRef });

  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_CONVERT', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { applicationId, applicationRef: appRef, grossAmount, grossSource: gross.source },
  }));

  // Client 06-10-2026: a converted enquiry must appear in BOTH the Applications list
  // AND the Underwriting list straight away, so open its underwriting case (New Review)
  // and seed its steps at convert time. Never blocks the conversion.
  try {
    const underwriting = require('./underwriting.service');
    const caseId = await underwriting.ensureCase(applicationId, req);
    if (caseId && underwriting.seedSteps) await underwriting.seedSteps(caseId, req);
  } catch (e) {
    console.error('[convert] could not open underwriting case for application ' + applicationId + ': ' + e.message);
  }

  // Client 29-09-2026: e-mail the Credit Deal Summary (PDF) to Head of Application users,
  // with the narrative notes typed in the Convert popup. Never blocks the conversion.
  let summary;
  try {
    const { sendDealSummary } = require('./dealSummary.service');
    const narrative = String((req && req.body && req.body.summary_notes) || '').trim().slice(0, 4000);
    summary = await sendDealSummary({ applicationId, applicationRef: appRef, enquiry, terms: gross, narrative, req });
  } catch (e) {
    console.error('[convert] deal summary not sent for application ' + applicationId + ': ' + e.message);
    summary = { ok: false, sentTo: 0, error: e.message };
  }
  return { ok: true, applicationId, applicationRef: appRef, grossAmount, grossSource: gross.source, summary };
}

/** Dropdown/reference data for the enquiry form (no masters permission needed). */
/** Per-status counts for the listing filter chips (global, not search-filtered). */
async function statusCounts(opts = {}) {
  const scoped = int(opts.scopeUserId);
  // "My deals" toggle: counts follow the list so chip numbers match the table.
  const me = opts.mine ? int(opts.currentUserId) : 0;
  const p = {};
  if (scoped) p.scope_uid = scoped;
  if (me) p.me = me;
  const rows = await db.queryNamed(
    `SELECT st.code AS code, COUNT(*) AS n
       FROM enquiries e
       LEFT JOIN enquiry_statuses st ON st.enquiry_status_id = e.enquiry_status_id
      WHERE e.flag_deleted = 0${scoped ? ' AND e.assigned_to = @scope_uid' : ''}${me ? ' AND e.assigned_to = @me' : ''}
      GROUP BY st.code`,
    p,
  );
  const byCode = {};
  let total = 0;
  for (const r of rows) {
    if (r.code) byCode[String(r.code).toUpperCase()] = r.n;
    total += r.n;
  }
  return { total, byCode };
}

const LEAD_SOURCES = ['Broker Introduction', 'Website Enquiry', 'Referral', 'Phone Enquiry', 'Repeat Client'];

/**
 * Request Information — actually EMAIL the chosen recipient.
 *
 * This used to only flip the status to CONTACTED and write a note, while the
 * UI reported "Information request sent". Nothing was ever sent.
 *
 * recipient: 'BDM / Sales' -> the assigned BDM
 *            'Broker'      -> the broker on the enquiry
 *            'Applicant'   -> the applicant's own address
 */
async function requestInfo(id, body, req) {
  const rows = await db.query(
    `SELECT e.enquiry_id, e.enquiry_ref, e.email AS applicant_email,
            e.applicant_name, e.company_name, e.broker_id, e.property_address, e.postcode, e.additional_securities,
            u.full_name AS bdm_name, u.email AS bdm_email,
            br.name AS broker_name, br.company AS broker_company, br.email AS broker_email
       FROM enquiries e
       LEFT JOIN users u ON u.user_id = e.assigned_to
       LEFT JOIN brokers br ON br.broker_id = e.broker_id
      WHERE e.enquiry_id = @p0 AND e.flag_deleted = 0`, [id]);
  if (!rows.length) return { notFound: true };
  const e = rows[0];

  const sendTo = String((body && body.send_to) || '').trim();
  const items = Array.isArray(body && body.items) ? body.items.map((x) => String(x)) : [];
  const comments = body && body.comments ? String(body.comments).trim() : '';
  const dueDate = body && body.due_date ? String(body.due_date).slice(0, 10) : '';

  const targets = {
    'BDM / Sales': { email: e.bdm_email, name: e.bdm_name || 'BDM' },
    Broker: { email: e.broker_email, name: e.broker_name || 'Broker' },
    Applicant: { email: e.applicant_email, name: e.company_name || e.applicant_name || 'Applicant' },
  };
  const target = targets[sendTo];
  if (!target) return { ok: false, error: 'Choose who to send the request to' };
  if (!target.email) {
    // Say WHICH address is missing rather than failing silently - the old code
    // could not fail at all because it never tried to send.
    return { ok: false, error: `No email address on file for the ${sendTo}`, errors: { send_to: `No email address on file for the ${sendTo}` } };
  }

  const who = e.company_name || e.applicant_name || 'the applicant';
  // Client 09-10-2026: list BOTH / all security properties on the enquiry, not just the main one.
  let addSecs = [];
  try { addSecs = e.additional_securities ? JSON.parse(e.additional_securities) : []; } catch (_) { addSecs = []; }
  const secAddrs = [];
  const seenSec = new Set();
  const pushSec = (v) => {
    const t = String(v == null ? '' : v).trim();
    if (!t) return; const k = t.toUpperCase().replace(/\s/g, '');
    if (seenSec.has(k)) return; seenSec.add(k); secAddrs.push(t);
  };
  // Client 09-10-2026: full security address INCLUDING postcode.
  const withPc = (addr, pc) => {
    const a = String(addr == null ? '' : addr).trim();
    const p = String(pc == null ? '' : pc).trim();
    if (!a) return p;
    if (!p || a.toUpperCase().replace(/\s/g, '').includes(p.toUpperCase().replace(/\s/g, ''))) return a;
    return `${a}, ${p}`;
  };
  pushSec(withPc(e.property_address, e.postcode));
  (Array.isArray(addSecs) ? addSecs : []).forEach((x) => { if (x) pushSec(withPc(x.address || x.description, x.postcode)); });
  const secHtml = secAddrs.length > 1
    ? `<p><strong>Security addresses:</strong></p><ul>${secAddrs.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
    : `<p><strong>Security address:</strong> ${escapeHtml(secAddrs[0] || '—')}</p>`;
  const list = items.length
    ? `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
    : '<p>No specific items were listed.</p>';
  // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
  const mailVars = {
    Ref: e.enquiry_ref, Borrower: who, SecurityAddress: secAddrs.join('; '), RecipientName: target.name,
    RequestedItems: items.join(', '), DueDate: dueDate, Notes: comments,
    SecurityBlock: secHtml, RequestedItemsList: list,
    DueDateBlock: dueDate ? `<p><strong>Please respond by:</strong> ${escapeHtml(dueDate)}</p>` : '',
    NotesBlock: comments ? `<p><strong>Notes:</strong><br>${escapeHtml(comments).replace(/\n/g, '<br>')}</p>` : '',
  };
  const { subject: mailSubject, html } = emailHub.render('ENQUIRY_INFO_REQUEST', mailVars);

  // Client 06-10-2026: the relevant BDM is always copied in (cc) so they see the
  // request and are in the loop on any reply. (BDM / Sales is no longer a send-to.)
  const ccList = (e.bdm_email && String(e.bdm_email).toLowerCase() !== String(target.email || '').toLowerCase())
    ? [e.bdm_email] : [];
  const sent = await mail.sendMail({
    to: target.email,
    cc: ccList,
    subject: mailSubject,
    html,
    // Email Settings master + Email History (client 17-10-2026)
    event: 'ENQUIRY_INFO_REQUEST', ref: { module: 'ENQUIRY', id, number: e.enquiry_ref }, req, vars: mailVars,
  });

  const noteParts = [`Information requested from ${sendTo} (${target.email})${ccList.length ? ' — cc BDM ' + ccList[0] : ''}`];
  if (items.length) noteParts.push('Items: ' + items.join(', '));
  if (dueDate) noteParts.push('Due ' + dueDate);
  if (comments) noteParts.push(comments);
  if (!sent.ok) noteParts.push('EMAIL FAILED: ' + (sent.error || 'unknown error'));
  await addNote(id, noteParts.join('. '), req).catch(() => {});

  await audit.write(audit.fromReq(req, {
    action: sent.ok ? 'INFO_REQUEST_EMAILED' : 'INFO_REQUEST_EMAIL_FAILED',
    moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { send_to: sendTo, to: target.email, items, due_date: dueDate || null, error: sent.ok ? null : sent.error },
  }));

  // Status only moves when the message actually went.
  if (sent.ok) {
    await workflow.applyStatus(id, workflow.S.CONTACTED, req, { force: true, reason: 'Requested Information' }).catch(() => {});
  }

  return sent.ok
    ? { ok: true, sent_to: target.email, recipient: sendTo }
    : { ok: false, error: `Could not email the ${sendTo}: ${sent.error || 'send failed'}` };
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The whole case history as seen from the enquiry: its own rows, plus the
 * application and underwriting rows once it has been converted. One continuous
 * story rather than a trail that stops at conversion.
 */
async function listAudit(id) {
  const rows = await db.query(
    `SELECT TOP 1 e.converted_application_id AS application_id,
            (SELECT TOP 1 uc.underwriting_case_id FROM underwriting_cases uc
              WHERE uc.application_id = e.converted_application_id AND uc.flag_deleted = 0
              ORDER BY uc.underwriting_case_id DESC) AS underwriting_case_id
       FROM enquiries e WHERE e.enquiry_id = @p0`, [id]);
  const link = rows[0] || {};

  const chain = [{ entity: 'enquiries', id, module: 'Enquiry' }];
  if (link.application_id) chain.push({ entity: 'applications', id: link.application_id, module: 'Application' });

  const logs = await audit.listForChain(chain);
  const uw = link.underwriting_case_id
    ? await underwritingTrail(link.underwriting_case_id).catch(() => [])
    : [];
  return audit.mergeTrails(logs, uw);
}

/**
 * Underwriting keeps its own table (underwriting_audit), so its rows are
 * reshaped to the audit_logs shape before merging - same keys, same renderer.
 */
async function underwritingTrail(caseId) {
  const rows = await db.query(
    `SELECT ua.underwriting_audit_id AS audit_id, ua.step_no, ua.action, ua.from_status, ua.to_status,
            ua.reason, ua.created_at, ua.user_id, ua.role_name, u.full_name AS user_name
       FROM underwriting_audit ua
       LEFT JOIN users u ON u.user_id = ua.user_id
      WHERE ua.underwriting_case_id = @p0
      ORDER BY ua.underwriting_audit_id DESC`, [caseId]);
  return rows.map((r) => ({ ...r, details: null, entity_name: 'underwriting_cases', module: 'Underwriting' }));
}

async function createBroker(body, req) {
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Broker name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Name must be 150 characters or fewer' } };
  const email = String((body && body.email) || '').trim();
  const phone = String((body && body.phone) || '').trim();
  const company = String((body && body.company) || '').trim();
  // Client 06-10-2026: COMPANY is the broker's unique key. Broker name and email
  // may repeat across brokers; the COMPANY NAME must be different.
  if (!company) return { ok: false, errors: { company: 'Company name is required' } };
  if (company.length > 150) return { ok: false, errors: { company: 'Company must be 150 characters or fewer' } };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { email: 'Enter a valid email address' } };
  if (email.length > 150) return { ok: false, errors: { email: 'Email must be 150 characters or fewer' } };
  if (phone.length > 30) return { ok: false, errors: { phone: 'Phone must be 30 characters or fewer' } };
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) return { ok: false, errors: { phone: 'Enter a valid phone number (digits only)' } };
  if (!email) return { ok: false, errors: { email: 'Broker email is required' } };
  // Client 15-10-2026: Address + FCA Number (application form section 1).
  const address = String((body && body.address) || '').trim();
  const fca = String((body && body.fca_number) || '').trim();
  if (address.length > 500) return { ok: false, errors: { address: 'Address must be 500 characters or fewer' } };
  if (fca.length > 50) return { ok: false, errors: { fca_number: 'FCA number must be 50 characters or fewer' } };
  const dupC = await db.query('SELECT TOP 1 broker_id FROM brokers WHERE flag_deleted = 0 AND LOWER(company) = LOWER(@p0)', [company]);
  if (dupC.length) return { ok: false, errors: { company: 'A broker with this company name already exists' } };
  const code = 'BRK' + Date.now();
  const uidv = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `INSERT INTO brokers (code, name, company, email, phone, created_by, address, fca_number)
     OUTPUT INSERTED.broker_id AS id, INSERTED.name AS name, INSERTED.company AS company
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)`,
    [code, name, company, email || null, phone || null, uidv, address || null, fca || null],
  );
  return { ok: true, id: out[0].id, name: out[0].name, company: out[0].company };
}

/**
 * Update an EXISTING broker in place (client 07-10-2026: edit icon on the broker
 * dropdown). Same validation as createBroker; the COMPANY uniqueness check
 * excludes the broker being edited so re-saving its own company is allowed.
 */
async function updateBroker(id, body, req) {
  const brokerId = Number(id);
  if (!Number.isFinite(brokerId) || brokerId <= 0) return { ok: false, errors: { id: 'Invalid broker' } };
  const exists = await db.query('SELECT TOP 1 broker_id FROM brokers WHERE broker_id = @p0 AND flag_deleted = 0', [brokerId]);
  if (!exists.length) return { notFound: true };
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, errors: { name: 'Broker name is required' } };
  if (name.length > 150) return { ok: false, errors: { name: 'Name must be 150 characters or fewer' } };
  const email = String((body && body.email) || '').trim();
  const phone = String((body && body.phone) || '').trim();
  const company = String((body && body.company) || '').trim();
  if (!company) return { ok: false, errors: { company: 'Company name is required' } };
  if (company.length > 150) return { ok: false, errors: { company: 'Company must be 150 characters or fewer' } };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { email: 'Enter a valid email address' } };
  if (email.length > 150) return { ok: false, errors: { email: 'Email must be 150 characters or fewer' } };
  if (phone.length > 30) return { ok: false, errors: { phone: 'Phone must be 30 characters or fewer' } };
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) return { ok: false, errors: { phone: 'Enter a valid phone number (digits only)' } };
  const address = String((body && body.address) || '').trim();
  const fca = String((body && body.fca_number) || '').trim();
  if (address.length > 500) return { ok: false, errors: { address: 'Address must be 500 characters or fewer' } };
  if (fca.length > 50) return { ok: false, errors: { fca_number: 'FCA number must be 50 characters or fewer' } };
  const dupC = await db.query('SELECT TOP 1 broker_id FROM brokers WHERE flag_deleted = 0 AND LOWER(company) = LOWER(@p0) AND broker_id <> @p1', [company, brokerId]);
  if (dupC.length) return { ok: false, errors: { company: 'A broker with this company name already exists' } };
  const uidv = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `UPDATE brokers SET name = @p1, company = @p2, email = @p3, phone = @p4, updated_by = @p5, updated_at = SYSUTCDATETIME(),
            address = @p6, fca_number = @p7
      OUTPUT INSERTED.broker_id AS id, INSERTED.name AS name, INSERTED.company AS company, INSERTED.email AS email, INSERTED.phone AS phone,
             INSERTED.address AS address, INSERTED.fca_number AS fca_number
      WHERE broker_id = @p0 AND flag_deleted = 0`,
    [brokerId, name, company, email || null, phone || null, uidv, address || null, fca || null],
  );
  return { ok: true, id: out[0].id, name: out[0].name, company: out[0].company, email: out[0].email, phone: out[0].phone, address: out[0].address, fca_number: out[0].fca_number };
}

/**
 * Borrower's Solicitor master (borrower_solicitors) add / edit from the New Enquiry popup
 * (client 15-10-2026), same pattern as the broker dropdown. Firm name is required + unique.
 */
function solicitorInput(body) {
  const s = (k, n) => String((body && body[k]) || '').trim().slice(0, n + 1);
  const firm = s('firm', 150); const contact = s('contact_name', 150); const address = s('address', 500);
  const phone = s('telephone', 30); const email = s('email', 150);
  const errors = {};
  if (!firm) errors.firm = "Borrower's solicitor / firm name is required";
  else if (textError(firm, 'text')) errors.firm = textError(firm, 'text');
  if (textError(contact, 'name')) errors.contact_name = textError(contact, 'name');
  if (textError(address, 'text')) errors.address = textError(address, 'text');
  else if (firm.length > 150) errors.firm = 'Firm name must be 150 characters or fewer';
  if (contact.length > 150) errors.contact_name = 'Contact name must be 150 characters or fewer';
  if (address.length > 500) errors.address = 'Address must be 500 characters or fewer';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email address';
  if (email.length > 150) errors.email = 'Email must be 150 characters or fewer';
  if (phone.length > 30) errors.telephone = 'Telephone must be 30 characters or fewer';
  if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) errors.telephone = 'Enter a valid telephone number (digits only)';
  // Client 15-10-2026: Number of SRA Partners (application form section 5), optional whole number.
  let sra = null;
  const rawSra = body && body.sra_partners;
  if (rawSra !== undefined && rawSra !== null && String(rawSra).trim() !== '') {
    const n = Number(rawSra);
    if (!Number.isInteger(n) || n < 0 || n > 99999) errors.sra_partners = 'Number of SRA partners must be a whole number';
    else sra = n;
  }
  return { errors, firm, contact, address, phone, email, sra };
}
const solicitorOut = (r) => ({ id: r.id, firm: r.firm_name, contact_name: r.contact_name || null, address: r.address || null, telephone: r.telephone || null, email: r.email || null, sra_partners: r.sra_partners ?? null });
const SOL_OUT = 'INSERTED.borrower_solicitor_id AS id, INSERTED.firm_name, INSERTED.contact_name, INSERTED.address, INSERTED.telephone, INSERTED.email, INSERTED.sra_partners';
/** Next BSL-#### code - same format the Masters screen generates. */
async function nextBorrowerSolicitorCode() {
  const r = await db.query(`SELECT ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(code, 5, 20))), 0) AS n FROM borrower_solicitors WHERE code LIKE 'BSL-%'`);
  return 'BSL-' + String(((r[0] && r[0].n) || 0) + 1).padStart(4, '0');
}

async function createSolicitor(body, req) {
  const v = solicitorInput(body);
  if (Object.keys(v.errors).length) return { ok: false, errors: v.errors };
  const dup = await db.query(
    `SELECT TOP 1 borrower_solicitor_id FROM borrower_solicitors WHERE flag_deleted = 0 AND LOWER(firm_name) = LOWER(@p0)`, [v.firm]);
  if (dup.length) return { ok: false, errors: { firm: 'A solicitor with this firm name already exists - pick it from the list' } };
  if (v.email) {
    const dupE = await db.query(
      `SELECT TOP 1 borrower_solicitor_id FROM borrower_solicitors WHERE flag_deleted = 0 AND LOWER(email) = LOWER(@p0)`, [v.email]);
    if (dupE.length) return { ok: false, errors: { email: 'A solicitor with this email already exists - pick it from the list' } };
  }
  const uidv = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `INSERT INTO borrower_solicitors (code, firm_name, contact_name, address, telephone, email, created_by, sra_partners)
     OUTPUT ${SOL_OUT}
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)`,
    [await nextBorrowerSolicitorCode(), v.firm, v.contact || null, v.address || null, v.phone || null, v.email || null, uidv, v.sra]);
  return { ok: true, ...solicitorOut(out[0]) };
}

async function updateSolicitor(id, body, req) {
  const sid = Number(id);
  if (!Number.isFinite(sid) || sid <= 0) return { ok: false, errors: { id: 'Invalid solicitor' } };
  const exists = await db.query('SELECT TOP 1 borrower_solicitor_id FROM borrower_solicitors WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0', [sid]);
  if (!exists.length) return { notFound: true };
  const v = solicitorInput(body);
  if (Object.keys(v.errors).length) return { ok: false, errors: v.errors };
  const dup = await db.query(
    `SELECT TOP 1 borrower_solicitor_id FROM borrower_solicitors WHERE flag_deleted = 0 AND LOWER(firm_name) = LOWER(@p0) AND borrower_solicitor_id <> @p1`, [v.firm, sid]);
  if (dup.length) return { ok: false, errors: { firm: 'Another solicitor already has this firm name' } };
  if (v.email) {
    const dupE = await db.query(
      `SELECT TOP 1 borrower_solicitor_id FROM borrower_solicitors WHERE flag_deleted = 0 AND LOWER(email) = LOWER(@p0) AND borrower_solicitor_id <> @p1`, [v.email, sid]);
    if (dupE.length) return { ok: false, errors: { email: 'Another solicitor already has this email' } };
  }
  const uidv = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `UPDATE borrower_solicitors SET firm_name = @p1, contact_name = @p2, address = @p3, telephone = @p4, email = @p5,
            updated_by = @p6, updated_at = SYSUTCDATETIME(), sra_partners = @p7
      OUTPUT ${SOL_OUT}
      WHERE borrower_solicitor_id = @p0 AND flag_deleted = 0`,
    [sid, v.firm, v.contact || null, v.address || null, v.phone || null, v.email || null, uidv, v.sra]);
  // Open (not yet converted) enquiries linked to this solicitor pick up the edit.
  await db.query(
    `UPDATE enquiries SET borrower_sol_firm = @p1, borrower_sol_contact = @p2, borrower_sol_address = @p3,
            borrower_sol_telephone = @p4, borrower_sol_email = @p5
      WHERE borrower_solicitor_id = @p0 AND converted_application_id IS NULL AND flag_deleted = 0`,
    [sid, v.firm, v.contact || null, v.address || null, v.phone || null, v.email || null]);
  return { ok: true, ...solicitorOut(out[0]) };
}

/* ------------------------------------------------------------------ *
 * Decline with reasons + bring back alive (client 29-09-2026)
 * ------------------------------------------------------------------ */

/** Decline history of an enquiry, newest first, each with its ticked reasons. */
async function listDeclines(id) {
  let rows;
  try {
    rows = await db.query(
      `SELECT d.enquiry_decline_id, d.notes, d.previous_status_code,
              d.declined_by, du.full_name AS declined_by_name, d.declined_at,
              d.reopened_by, ru.full_name AS reopened_by_name, d.reopened_at, d.reopen_note
         FROM enquiry_declines d
         LEFT JOIN users du ON du.user_id = d.declined_by
         LEFT JOIN users ru ON ru.user_id = d.reopened_by
        WHERE d.enquiry_id = @p0
        ORDER BY d.enquiry_decline_id DESC`,
      [id],
    );
  } catch (_) {
    return []; // tables not migrated yet — never break the detail screen
  }
  if (!rows.length) return rows;
  const reasons = await db.query(
    `SELECT m.enquiry_decline_id, m.decline_reason_id AS id, m.reason_name AS name
       FROM enquiry_decline_reason_map m
       JOIN enquiry_declines d ON d.enquiry_decline_id = m.enquiry_decline_id
      WHERE d.enquiry_id = @p0
      ORDER BY m.enquiry_decline_reason_map_id`,
    [id],
  );
  for (const r of rows) {
    r.reasons = reasons.filter((x) => x.enquiry_decline_id === r.enquiry_decline_id)
      .map((x) => ({ id: x.id, name: x.name }));
  }
  return rows;
}

/**
 * Decline an enquiry with one or more master reasons (+ optional notes).
 * body: { reason_ids: number[], notes?: string }
 */
async function decline(id, body, req) {
  const ids = [...new Set((Array.isArray(body && body.reason_ids) ? body.reason_ids : [])
    .map((v) => int(v)).filter((v) => v > 0))];
  const notes = String((body && body.notes) || '').trim().slice(0, 2000) || null;
  if (!ids.length) return { ok: false, errors: { reason_ids: 'Select at least one decline reason' } };

  const cur = await workflow.currentCode(id);
  if (!cur.found) return { ok: false, notFound: true };
  const conv = await db.query('SELECT converted_application_id FROM enquiries WHERE enquiry_id = @p0', [id]);
  if (conv[0] && conv[0].converted_application_id) return { ok: false, error: 'A converted enquiry cannot be declined' };
  if (cur.code === 'LOST') return { ok: false, error: 'This enquiry is already declined' };

  const ph = ids.map((_, i) => '@p' + i).join(', ');
  const reasons = await db.query(
    `SELECT decline_reason_id AS id, name FROM decline_reasons
      WHERE decline_reason_id IN (${ph}) AND flag_deleted = 0 AND is_active = 1`,
    ids,
  );
  if (reasons.length !== ids.length) return { ok: false, errors: { reason_ids: 'One or more reasons are not valid' } };

  const summary = reasons.map((r) => r.name).join(', ') + (notes ? ' — ' + notes : '');
  const res = await changeStatus(id, workflow.S.LOST, req, ('Declined: ' + summary).slice(0, 500));
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Could not decline enquiry' };

  const uid = req && req.userData ? req.userData.userId : null;
  const out = await db.query(
    `INSERT INTO enquiry_declines (enquiry_id, notes, previous_status_code, declined_by)
     OUTPUT INSERTED.enquiry_decline_id AS id VALUES (@p0, @p1, @p2, @p3)`,
    [id, notes, cur.code, uid],
  );
  const declineId = out[0].id;
  for (const r of reasons) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `INSERT INTO enquiry_decline_reason_map (enquiry_decline_id, decline_reason_id, reason_name) VALUES (@p0, @p1, @p2)`,
      [declineId, r.id, r.name],
    );
  }
  await db.query('UPDATE enquiries SET lost_reason = @p1 WHERE enquiry_id = @p0', [id, summary.slice(0, 1000)]);
  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_DECLINE', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { reasons: reasons.map((r) => r.name), notes, previous_status: cur.code },
  }));
  return { ok: true, id, decline_id: declineId };
}

/**
 * Delete an enquiry made by mistake (client 26-10-2026) - instead of declining it,
 * which counts it as a lost deal in the reports. Logical delete (flag_deleted = 1):
 * it leaves every list, count, dashboard and report. A converted enquiry cannot be
 * deleted (its application / loan depend on it).
 */
async function remove(id, req) {
  const row = (await db.query(
    'SELECT enquiry_ref, converted_application_id FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0', [id]))[0];
  if (!row) return { ok: false, notFound: true };
  if (row.converted_application_id) return { ok: false, error: 'This enquiry has been converted to an application and cannot be deleted' };
  const uid = req && req.userData ? req.userData.userId : null;
  await db.query(
    `UPDATE enquiries SET flag_deleted = 1, deleted_on = SYSUTCDATETIME(), updated_by = @p1, updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0 AND flag_deleted = 0`,
    [id, uid],
  );
  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_DELETE', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { enquiry_ref: row.enquiry_ref },
  }));
  return { ok: true, id };
}

/**
 * Bring a declined enquiry back alive: restores the status it had before the
 * decline (falls back to ASSIGNED / NEW) and stamps the decline row as re-opened.
 * body: { note?: string }
 */
async function reopen(id, body, req) {
  const cur = await workflow.currentCode(id);
  if (!cur.found) return { ok: false, notFound: true };
  if (cur.code !== 'LOST') return { ok: false, error: 'Only a declined enquiry can be re-opened' };
  const note = String((body && body.note) || '').trim().slice(0, 1000) || null;

  const last = await db.query(
    `SELECT TOP 1 enquiry_decline_id, previous_status_code FROM enquiry_declines
      WHERE enquiry_id = @p0 AND reopened_at IS NULL ORDER BY enquiry_decline_id DESC`,
    [id],
  ).catch(() => []);
  const own = await db.query('SELECT assigned_to, offer_accepted_at FROM enquiries WHERE enquiry_id = @p0', [id]);
  let target = last[0] && last[0].previous_status_code;
  if (!target || workflow.TERMINAL.has(String(target).toUpperCase())) {
    target = own[0] && own[0].assigned_to ? workflow.S.ASSIGNED : workflow.S.NEW;
  }
  // Client 15-10-2026: offer was ACCEPTED before the decline -> re-open at the
  // Send Indicatives stage (not straight back to Offer Accepted). The old offer(s)
  // are superseded and the offer stamps cleared so the stepper / header show the
  // indicative stage and a fresh offer has to be sent.
  const wasAccepted = String(target).toUpperCase() === workflow.S.OFFER_ACCEPTED || !!(own[0] && own[0].offer_accepted_at);
  if (wasAccepted) target = workflow.S.INDICATIVE_SENT;

  // Leaving LOST is not in the forward-only graph, so the engine is forced here;
  // the route itself is permission-guarded (same right as Decline).
  const res = await workflow.applyStatus(id, target, req, { force: true, reason: 'Re-opened' + (note ? ': ' + note : '') });
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Could not re-open enquiry' };

  const uid = req && req.userData ? req.userData.userId : null;
  if (last[0]) {
    await db.query(
      `UPDATE enquiry_declines SET reopened_by = @p1, reopened_at = SYSUTCDATETIME(), reopen_note = @p2
        WHERE enquiry_decline_id = @p0`,
      [last[0].enquiry_decline_id, uid, note],
    );
  }
  await db.query('UPDATE enquiries SET lost_reason = NULL WHERE enquiry_id = @p0', [id]);
  if (wasAccepted) {
    await db.query(
      `UPDATE enquiry_offers SET status = 'Superseded', updated_at = SYSUTCDATETIME()
        WHERE enquiry_id = @p0 AND status IN ('Sent', 'Accepted') AND flag_deleted = 0`, [id]);
    await db.query(
      `UPDATE enquiries SET offer_sent_at = NULL, offer_accepted_at = NULL, current_offer_id = NULL,
              indicative_sent_at = COALESCE(indicative_sent_at, SYSUTCDATETIME()), updated_at = SYSUTCDATETIME()
        WHERE enquiry_id = @p0`, [id]);
  }
  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_REOPEN', moduleKey: CFG.MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { restored_status: target, note, from_accepted_offer: wasAccepted || undefined },
  }));
  const row = (await db.query('SELECT assigned_to, enquiry_ref FROM enquiries WHERE enquiry_id = @p0', [id]))[0] || {};
  await notify.enquiryStatusChanged({
    enquiryId: id, ref: row.enquiry_ref || null, toCode: target, statusName: target,
    assignedTo: row.assigned_to || null, actorId: uid,
  });
  return { ok: true, id, code: target };
}

async function formOptions(currentUserId = null) {
  const [branches, products, purposes, sources, leadSourceRows, brokers, applicantTypes, statuses, assignees, documentTypes, declineReasons] = await Promise.all([
    db.query(`SELECT branch_id AS id, branch_name AS name FROM branches WHERE flag_deleted = 0 AND is_active = 1 ORDER BY branch_name`),
    db.query(`SELECT product_id AS id, name FROM products WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT loan_purpose_id AS id, name FROM loan_purposes WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT application_source_id AS id, name FROM application_sources WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT lead_source_id AS id, name FROM lead_sources WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`).catch(() => null),
    db.query(`SELECT broker_id AS id, name, company, email, phone, address, fca_number FROM brokers WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT applicant_type_id AS id, name FROM applicant_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY CASE WHEN name LIKE 'Scotland%' THEN 0 ELSE 1 END, CASE WHEN name LIKE '%Individual%' THEN 0 ELSE 1 END, name`),
    db.query(`SELECT enquiry_status_id AS id, code, name FROM enquiry_statuses WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order`),
    // Assignable BDMs = users whose role can add/edit/delete enquiries
    // (plus super admins). Permission-driven, NOT role-name — survives role renames.
    db.query(
      `SELECT DISTINCT u.user_id AS id, u.full_name AS name, u.email AS email
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.user_id
         LEFT JOIN role_permissions rp ON rp.role_id = COALESCE(ur.role_id, u.role_id)
         LEFT JOIN permissions p ON p.permission_id = rp.permission_id
         LEFT JOIN roles rr ON rr.role_id = rp.role_id
        WHERE u.flag_deleted = 0 AND u.is_active = 1
          AND ( (p.module_key = 'ENQUIRIES.ENQUIRY_LIST' AND p.permission_key IN ('add', 'edit', 'delete')
                 AND rr.flag_deleted = 0 AND rr.is_active = 1)
                OR u.is_super_admin = 1 )
        ORDER BY u.full_name`),
    db.query(`SELECT document_type_id AS id, name, category FROM document_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(`SELECT decline_reason_id AS id, name FROM decline_reasons WHERE flag_deleted = 0 AND is_active = 1 ORDER BY ISNULL(sort_order, 9999), name`).catch(() => []),
  ]);
  // Borrower's solicitor dropdown (client 15-10-2026). Separate query so a DB without the
  // borrower_solicitors table yet (migration 075 not run) still loads the form.
  const solicitors = await db.query(
    `SELECT borrower_solicitor_id AS id, firm_name, contact_name, address, telephone, email, sra_partners FROM borrower_solicitors
      WHERE flag_deleted = 0 AND is_active = 1 ORDER BY firm_name`)
    .then((rows) => rows.map(solicitorOut)).catch(() => []);
  // Fallback only when lead_sources is missing; all-inactive -> empty list.
  const leadSources = leadSourceRows ? leadSourceRows.map((r) => ({ id: r.id, name: r.name })) : LEAD_SOURCES.map((name) => ({ id: null, name }));

  // Always include the current user in the assignee list — a user can be
  // assigned to their own enquiry even if their role lacks ENQUIRY_LIST.assign
  // (e.g. a BDM self-assigning on intake). Prevents a "— Unassigned —" default.
  let assigneeList = assignees;
  if (currentUserId != null && !assigneeList.some((a) => Number(a.id) === Number(currentUserId))) {
    const me = await db.query(
      `SELECT user_id AS id, full_name AS name, email FROM users WHERE user_id = @p0 AND flag_deleted = 0 AND is_active = 1`,
      [currentUserId],
    );
    if (me.length) assigneeList = [me[0], ...assigneeList];
  }

  return { branches, products, purposes, sources, brokers, solicitors, applicantTypes, statuses, assignees: assigneeList, documentTypes, leadSources, declineReasons };
}

module.exports = {
  computeCombinedLtv, computeLoanLtv, indicativeLtv,
  validate, validateApplicants, generateRef, list, getById, create, update, assign,
  changeStatus, decline, reopen, remove, listDeclines, listNotes, addNote, checkConvert, checkOffer, convert, formOptions, statusCounts,
  listAudit, underwritingTrail, requestInfo,
  addDocument, getDocument, updateDocument, deleteDocument, saveOffer, createBroker, updateBroker, createSolicitor, updateSolicitor,
  agreedTerms, applyAgreedTerms, applyIndicativeToApplication, backfillAgreedTerms,
  listApplicants, saveApplicants,
};
