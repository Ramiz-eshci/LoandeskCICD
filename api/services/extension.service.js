'use strict';

/**
 * Portfolio Extensions workflow (client 30-09-2026).
 *
 * Owned end-to-end by the Portfolio team - it never goes back to underwriting:
 *
 *   Draft             raised from a facility: months needed, exit plan / evidence
 *   Agreement Sent    fees + interest agreed, "Extension Agreement" PDF e-mailed to the borrower
 *   Agreement Signed  signed agreement uploaded back
 *   Pending Approval  "Extension Request" mini credit paper sent to every Head of Extension
 *   Approved          Head of Extension approved -> facility maturity / term / schedule moved,
 *                     extension + document fees raised on the facility (Fees)
 *   Rejected          Head of Extension rejected
 *   Cancelled         withdrawn before a decision
 *
 * Fees: % or £. A % extension / document fee is a % of the facility's GROSS amount.
 *
 * Fee treatment (client 28-10-2026), chosen per fee on the extension form:
 *   Upfront   separate charge the borrower pays - gross / net / outstanding untouched. Raised on
 *             the facility's Fees as Due and listed on the extension's payment schedule; once
 *             approved, the extension stays in "Awaiting Fees" until every upfront fee is marked
 *             Paid (completed_at), then it moves back to the portfolio (Approved).
 *   Retained  added to the GROSS loan and the outstanding on approval (net unchanged); a % interest
 *             rate for the extension months is worked on that new gross. The fee row is kept on
 *             the facility as 'Capitalised' so it is not charged a second time at redemption.
 */

const db = require('../config/database');
const audit = require('./audit.service');
const mail = require('./mail.service');
const emailHub = require('./emailHub.service');
const notifications = require('./notification.service');
const application = require('./application.service');
const { config } = require('../config/env');
const { relatedSql } = require('../middlewares/portfolio-scope');
const pdf = require('./pdf/extension-pdf.service');

const MODULE_KEY = 'PORTFOLIO.EXTENSION';
const HEAD_MODULE = 'PORTFOLIO.HEAD_OF_EXTENSION';

const S = {
  DRAFT: 'Draft', SENT: 'Agreement Sent', SIGNED: 'Agreement Signed', PENDING: 'Pending Approval',
  APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
const OPEN = [S.DRAFT, S.SENT, S.SIGNED, S.PENDING];
const EDITABLE = [S.DRAFT, S.SENT, S.SIGNED];
const DECIDED = [S.APPROVED, S.REJECTED, S.CANCELLED];
const FEE_TYPES = new Set(['PCT', 'AMOUNT']);
const TIMINGS = new Set(['Upfront', 'Retained']);
const TREATMENTS = new Set(['Serviced', 'Retained']);
const DOC_KINDS = {
  AGREEMENT: 'EXTENSION_AGREEMENT',
  SIGNED_AGREEMENT: 'EXTENSION_AGREEMENT_SIGNED',
  REQUEST_PAPER: 'EXTENSION_REQUEST',
  EXIT_EVIDENCE: 'EXTENSION_EXIT_EVIDENCE',
  OTHER: 'EXTENSION_EXIT_EVIDENCE',
};
const UPLOAD_KINDS = new Set(['SIGNED_AGREEMENT', 'EXIT_EVIDENCE', 'OTHER']);
/** Editable paper / agreement wording (doc_json). */
const PAPER_KEYS = ['case_owner', 'funding_line', 'borrower_name', 'borrower_background', 'security_address',
  'purchase_info', 'title_number', 'value_text', 'valuation_type', 'valuer', 'site_visit', 'deal_type',
  'property_description', 'extension_request', 'credit_recommendation'];

// ---------------------------------------------------------------- helpers
const actorId = (req) => (req && req.userData ? req.userData.userId : null);
const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);
const iso = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
/** Calendar-safe month add (31 Jan + 1 = 28/29 Feb). */
function addMonths(isoDate, months) {
  const d0 = iso(isoDate);
  if (!d0) return null;
  const [y, m, d] = d0.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + Number(months || 0), 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const gbp = (v) => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseJson = (s) => { try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; } };
const customerNameSql = (a) => `COALESCE(NULLIF(${a}.company_name, ''), LTRIM(RTRIM(CONCAT(COALESCE(${a}.first_name, ''), ' ', COALESCE(${a}.last_name, '')))), ${a}.email, 'Customer')`;

async function docTypeId(code) {
  const r = await db.query('SELECT TOP 1 document_type_id AS id FROM document_types WHERE code = @p0', [code]);
  return r.length ? r[0].id : null;
}

// ---------------------------------------------------------------- facility data
/** Loan + application + primary applicant + originating enquiry, by loan_number or loan_id. */
async function facilityBase(loanKey) {
  const key = String(loanKey || '').trim();
  const rows = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.application_id, l.principal, l.rate_pct, l.term_months,
            l.outstanding_balance, l.status,
            CONVERT(varchar(10), l.start_date, 23) AS start_date,
            CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
            a.application_ref, a.net_advance, a.enquiry_id, a.assigned_to,
            p.name AS product,
            aa.applicant_id, ${customerNameSql('ap')} AS customer_name, ap.email AS customer_email,
            ap.company_name, ap.first_name, ap.last_name,
            sec.property_address AS security_address, sec.estimated_value AS security_value,
            sec.charge_type AS security_charge_type,
            uw.full_name AS underwriter_name,
            br.name AS broker_name, br.email AS broker_email, br.phone AS broker_phone
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       LEFT JOIN products p ON p.product_id = a.product_id
       LEFT JOIN users uw ON uw.user_id = a.underwriter_id
       LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
       LEFT JOIN brokers br ON br.broker_id = COALESCE(a.broker_id, enq.broker_id)
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       OUTER APPLY (SELECT TOP 1 s.property_address, s.estimated_value, s.charge_type
                      FROM application_security s
                     WHERE s.application_id = a.application_id AND s.flag_deleted = 0
                     ORDER BY s.security_id) sec
      WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)
      ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id`,
    { key },
  );
  return rows[0] || null;
}

/** Underwriting step fields ({} when missing); multi-entry steps return the accepted / latest entry. */
async function uwStepFields(applicationId, stepKey) {
  try {
    const r = await db.query(
      `SELECT TOP 1 us.data FROM underwriting_steps us
         JOIN underwriting_cases uc ON uc.underwriting_case_id = us.underwriting_case_id AND uc.flag_deleted = 0
        WHERE uc.application_id = @p0 AND us.step_key = @p1 AND ISJSON(us.data) = 1
        ORDER BY uc.underwriting_case_id DESC`, [applicationId, stepKey]);
    const f = (parseJson(r.length ? r[0].data : null).fields) || {};
    const entries = Array.isArray(f.entries) ? f.entries.filter(Boolean) : [];
    if (entries.length) {
      const pick = entries.find((e) => ['accepted', 'approved'].includes(String(e.result || e.status || '').toLowerCase())) || entries[entries.length - 1];
      return { ...f, ...pick };
    }
    return f;
  } catch (_) { return {}; }
}

/** Resolve a master id to its name (valuation type / valuer firm); strings pass through. */
async function masterName(table, idCol, v) {
  if (v === null || v === undefined || v === '') return '';
  if (!/^\d+$/.test(String(v))) return String(v);
  try {
    const r = await db.query(`SELECT TOP 1 * FROM ${table} WHERE ${idCol} = @p0`, [Number(v)]);
    const row = r[0] || {};
    return String(row.name || row.firm_name || row.valuer_name || row.title || v);
  } catch (_) { return String(v); }
}

/**
 * Every security property on the facility's application, main first, de-duplicated -
 * client 27-10-2026: the extension documents showed only the first one ("both address
 * should come"). Postcode appended when the address does not carry it, as on the Credit
 * Paper. Falls back to the enquiry's property. [{ address, url }]
 */
async function securityAddresses(applicationId, enq = {}) {
  let rows = [];
  try {
    rows = await db.query(
      `SELECT property_address, postcode, map_link FROM application_security
        WHERE application_id = @p0 AND flag_deleted = 0 ORDER BY security_id`, [applicationId]);
  } catch (_) { rows = []; }
  if (!rows.length && enq.property_address) rows = [{ property_address: enq.property_address, postcode: enq.postcode }];
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const a = String(r.property_address || '').trim();
    if (!a) continue;
    const pc = String(r.postcode || '').trim();
    const full = !pc || a.toUpperCase().replace(/\s/g, '').includes(pc.toUpperCase().replace(/\s/g, '')) ? a : `${a}, ${pc}`;
    const k = full.toUpperCase().replace(/\s/g, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ address: full, url: r.map_link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full)}` });
  }
  return out;
}

/** "1. A\n2. B" (several) or "A" (one) - the Credit Paper's Security Property Address(s) cell. */
const numberedAddresses = (list) => (list.length > 1 ? list.map((s, i) => `${i + 1}. ${s.address}`).join('\n') : (list[0] ? list[0].address : ''));

/**
 * The paper's Security Property Address(s), all securities. A paper saved before 27-10-2026
 * holds only the first security's address - treated as not edited, so every security shows;
 * an address the user typed is kept as it is.
 */
async function paperAddress(paper, f) {
  const secs = f ? await securityAddresses(f.application_id) : [];
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s,]/g, '');
  const saved = String((paper && paper.security_address) || '').trim();
  const stale = saved && secs.length > 1 && [secs[0].address, f && f.security_address].some((a) => a && norm(a) === norm(saved));
  return { address: !saved || stale ? (numberedAddresses(secs) || (f && f.security_address) || '') : saved, secs };
}

/** First-draft wording for the Extension Request paper, from the facility's own data. */
async function paperDefaults(f, body, uid) {
  let enq = {};
  if (f.enquiry_id) {
    try { enq = (await db.query('SELECT TOP 1 * FROM enquiries WHERE enquiry_id = @p0', [f.enquiry_id]))[0] || {}; } catch (_) { enq = {}; }
  }
  let owner = '';
  if (uid) {
    try { owner = ((await db.query('SELECT full_name FROM users WHERE user_id = @p0', [uid]))[0] || {}).full_name || ''; } catch (_) { owner = ''; }
  }
  const val = await uwStepFields(f.application_id, 'valuation_instruction');
  const site = await uwStepFields(f.application_id, 'site_diligence');
  const purchasePrice = num(enq.purchase_price);
  const purchaseDate = iso(enq.purchase_date);
  const value = num(val.market_value) || num(f.security_value) || num(enq.estimated_value);
  const charge = f.security_charge_type || enq.charge_type || '';
  const address = numberedAddresses(await securityAddresses(f.application_id, enq))
    || f.security_address || [enq.property_address, enq.postcode].filter(Boolean).join(', ');
  return {
    case_owner: owner,
    funding_line: f.product || '',
    borrower_name: f.customer_name || '',
    borrower_background: '',
    security_address: address || '',
    purchase_info: purchasePrice ? `Purchased by the client for ${gbp(purchasePrice).replace(/\.00$/, '')}${purchaseDate ? ' on ' + pdf.longDate(purchaseDate) : ''}` : '',
    title_number: '',
    value_text: value ? gbp(value).replace(/\.00$/, '') : '',
    valuation_type: await masterName('valuation_types', 'valuation_type_id', val.valuation_type),
    valuer: await masterName('valuer_firms', 'valuer_firm_id', val.valuer_firm),
    site_visit: site.visit_date ? `${site.visit_type || 'Site Visit'} – ${pdf.longDate(site.visit_date)}` : '',
    deal_type: [charge ? `${charge} charge` : null, f.product].filter(Boolean).join(' '),
    property_description: [enq.property_type, enq.tenure].filter(Boolean).join(', '),
    extension_request: str(body.reason, 8000) || '',
    credit_recommendation: '',
  };
}

// ---------------------------------------------------------------- figures
/** Total of the extension / document fees flagged Retained (added to the gross on approval). */
function retainedFees(x) {
  let t = 0;
  if (x.ext_fee_timing === 'Retained') t += num(x.ext_fee_amount) || 0;
  if (x.doc_fee_timing === 'Retained') t += num(x.doc_fee_amount) || 0;
  return round2(t);
}
/** Total of the fees the borrower pays separately (Upfront). */
function upfrontFees(x) {
  let t = 0;
  if (x.ext_fee_timing !== 'Retained') t += num(x.ext_fee_amount) || 0;
  if (x.doc_fee_timing !== 'Retained') t += num(x.doc_fee_amount) || 0;
  return round2(t);
}

/** Fill the derived figures (new maturity, £ fees, monthly interest) from the inputs. */
function derive(x) {
  const gross = num(x.gross_amount) || 0;
  const months = Math.max(1, Math.min(60, Number(x.extension_months) || 1));
  const feeAmt = (type, value) => {
    const v = num(value);
    if (v === null || v <= 0) return null;
    return round2(type === 'PCT' ? (gross * v) / 100 : v);
  };
  const out = { ...x, extension_months: months };
  out.new_maturity = addMonths(x.current_maturity, months);
  out.ext_fee_amount = feeAmt(x.ext_fee_type, x.ext_fee_value);
  out.doc_fee_amount = feeAmt(x.doc_fee_type, x.doc_fee_value);
  // Client 28-10-2026: Retained fees are added to the gross (fee % is still on the ORIGINAL gross).
  out.retained_fees = retainedFees(out);
  out.gross_after = round2(gross + out.retained_fees);
  // Client 09-10-2026: interest can be a % rate OR a manual amount. A % rate (monthly_rate_pct>0)
  // derives the monthly interest from the gross (28-10-2026: the gross incl. retained fees);
  // otherwise the manual monthly_interest stands.
  const mRate = num(x.monthly_rate_pct);
  if (mRate != null && mRate > 0) out.monthly_interest = round2((out.gross_after * mRate) / 100);
  // Client 08-10-2026: no default monthly interest - it is left blank until entered.
  return out;
}

function validate(x) {
  const errors = {};
  const months = Number(x.extension_months);
  if (!Number.isInteger(months) || months < 1 || months > 60) errors.extension_months = 'Extension length must be 1 to 60 months';
  if (!iso(x.current_maturity)) errors.current_maturity = 'Current maturity date is required';
  if (!FEE_TYPES.has(x.ext_fee_type)) errors.ext_fee_type = 'Extension fee must be % or £';
  if (!FEE_TYPES.has(x.doc_fee_type)) errors.doc_fee_type = 'Document fee must be % or £';
  for (const [k, lbl] of [['ext_fee_value', 'Extension fee'], ['doc_fee_value', 'Document fee'], ['monthly_interest', 'Monthly interest']]) {
    const v = x[k];
    if (v !== null && v !== undefined && v !== '' && (num(v) === null || num(v) < 0)) errors[k] = `${lbl} must be zero or more`;
  }
  if (x.ext_fee_type === 'PCT' && num(x.ext_fee_value) > 100) errors.ext_fee_value = 'Extension fee % cannot exceed 100';
  if (x.doc_fee_type === 'PCT' && num(x.doc_fee_value) > 100) errors.doc_fee_value = 'Document fee % cannot exceed 100';
  if (!TIMINGS.has(x.ext_fee_timing)) errors.ext_fee_timing = 'Extension fee must be Upfront or Retained';
  if (!TIMINGS.has(x.doc_fee_timing)) errors.doc_fee_timing = 'Document fee must be Upfront or Retained';
  if (!TREATMENTS.has(x.interest_treatment)) errors.interest_treatment = 'Interest must be Serviced or Retained';
  if (x.monthly_rate_pct !== null && x.monthly_rate_pct !== undefined && x.monthly_rate_pct !== '' && (num(x.monthly_rate_pct) === null || num(x.monthly_rate_pct) < 0 || num(x.monthly_rate_pct) > 100)) errors.monthly_rate_pct = 'Monthly rate % must be 0 to 100';
  for (const k of ['ext_fee_due_date', 'doc_fee_due_date', 'first_payment_date', 'agreement_date']) {
    if (x[k] && !iso(x[k])) errors[k] = 'Invalid date';
  }
  return Object.keys(errors).length ? errors : null;
}

// ---------------------------------------------------------------- read
const SELECT_ROW = `
  SELECT x.extension_id, x.extension_ref, x.loan_id, x.status,
         CONVERT(varchar(10), x.current_maturity, 23) AS current_maturity, x.extension_months,
         CONVERT(varchar(10), x.new_maturity, 23) AS new_maturity,
         x.gross_amount, x.net_amount, x.monthly_rate_pct,
         x.ext_fee_type, x.ext_fee_value, x.ext_fee_amount, x.ext_fee_timing,
         CONVERT(varchar(10), x.ext_fee_due_date, 23) AS ext_fee_due_date,
         x.doc_fee_type, x.doc_fee_value, x.doc_fee_amount, x.doc_fee_timing,
         CONVERT(varchar(10), x.doc_fee_due_date, 23) AS doc_fee_due_date,
         x.interest_treatment, x.monthly_interest, x.gross_after, x.retained_fees, x.completed_at,
         CONVERT(varchar(10), x.first_payment_date, 23) AS first_payment_date,
         x.exit_plan, x.doc_json,
         CONVERT(varchar(10), x.agreement_date, 23) AS agreement_date,
         x.agreement_sent_to, x.agreement_sent_at, x.agreement_document_id, x.signed_document_id, x.request_document_id,
         x.submitted_at, x.decision, x.decision_notes, x.decided_at, x.applied_at, x.created_at, x.updated_at,
         cu.full_name AS created_by_name, su.full_name AS submitted_by_name, du.full_name AS decided_by_name,
         l.loan_number, l.application_id, l.status AS loan_status,
         CONVERT(varchar(10), l.start_date, 23) AS loan_start_date,
         CONVERT(varchar(10), l.maturity_date, 23) AS loan_maturity_date,
         a.application_ref, ${customerNameSql('ap')} AS customer_name, ap.email AS customer_email, aa.applicant_id,
         br.email AS broker_email, br.name AS broker_name
    FROM portfolio_extensions x
    JOIN loans l ON l.loan_id = x.loan_id
    JOIN applications a ON a.application_id = l.application_id
    LEFT JOIN brokers br ON br.broker_id = a.broker_id
    OUTER APPLY (SELECT TOP 1 aa0.applicant_id FROM application_applicants aa0
                  WHERE aa0.application_id = a.application_id
                  ORDER BY CASE WHEN aa0.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa0.applicant_id) aa
    LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
    LEFT JOIN users cu ON cu.user_id = x.created_by
    LEFT JOIN users su ON su.user_id = x.submitted_by
    LEFT JOIN users du ON du.user_id = x.decided_by`;

function shape(r) {
  if (!r) return null;
  const paper = { ...parseJson(r.doc_json) };
  delete r.doc_json;
  return {
    ...r,
    paper,
    editable: EDITABLE.includes(r.status),
    open: OPEN.includes(r.status),
    // Approved but an upfront fee is still unpaid - stays under Extensions (client 28-10-2026).
    awaiting_fees: r.status === S.APPROVED && !r.completed_at,
    terms: {
      interest: pdf.interestText(r),
      extension_fee: pdf.feeText('ext', r, r.new_maturity),
      document_fee: pdf.feeText('doc', r, r.new_maturity),
    },
  };
}

async function row(id) {
  const rows = await db.query(`${SELECT_ROW} WHERE x.extension_id = @p0 AND x.flag_deleted = 0`, [Number(id) || 0]);
  return rows[0] || null;
}

async function documents(id) {
  return db.query(
    `SELECT xd.ext_doc_id, xd.kind, xd.app_document_id, d.file_name, d.created_at,
            COALESCE(u.full_name, 'System') AS uploaded_by_name
       FROM portfolio_extension_documents xd
       JOIN application_documents d ON d.app_document_id = xd.app_document_id AND d.flag_deleted = 0
       LEFT JOIN users u ON u.user_id = d.uploaded_by
      WHERE xd.extension_id = @p0 AND xd.flag_deleted = 0
      ORDER BY xd.ext_doc_id DESC`, [Number(id) || 0]);
}

async function get(id) {
  const r = await row(id);
  if (!r) return null;
  const out = shape(r);
  // Client 27-10-2026: the edit form shows every security too (old papers held only the first).
  out.paper.security_address = (await paperAddress(out.paper, await facilityBase(r.loan_id))).address;
  out.documents = await documents(id);
  out.payment_schedule = await paymentSchedule(r);
  return out;
}

/**
 * Extension payment schedule (client 28-10-2026): the fees it raised on the facility
 * (upfront = to collect, retained = added to the gross) and the interest instalments of the
 * extension months, each with what has been paid. Empty until the extension is approved.
 */
async function paymentSchedule(x) {
  if (x.status !== S.APPROVED) return { fees: [], instalments: [], upfront_total: 0, upfront_paid: 0, upfront_due: 0 };
  const fees = await db.query(
    `SELECT fee_id, fee_type, amount, CONVERT(varchar(10), due_date, 23) AS due_date, status, notes,
            CONVERT(varchar(10), paid_on, 23) AS paid_on, paid_method, paid_reference, paid_at
       FROM loan_fees WHERE extension_id = @p0 AND flag_deleted = 0 ORDER BY fee_id`, [x.extension_id]);
  const instalments = await db.query(
    `SELECT schedule_id, installment_no, CONVERT(varchar(10), due_date, 23) AS due_date, interest_due, total_due, status
       FROM loan_schedules
      WHERE loan_id = @p0 AND flag_deleted = 0 AND due_date > @p1 AND due_date <= @p2
      ORDER BY installment_no`, [x.loan_id, iso(x.current_maturity), iso(x.new_maturity)]);
  const up = fees.filter((f) => f.status !== 'Capitalised' && f.status !== 'Waived');
  const total = round2(up.reduce((s, f) => s + Number(f.amount || 0), 0));
  const paid = round2(up.filter((f) => f.status === 'Paid').reduce((s, f) => s + Number(f.amount || 0), 0));
  return { fees, instalments, upfront_total: total, upfront_paid: paid, upfront_due: round2(total - paid) };
}

/**
 * Approved extensions of a facility leave "Awaiting Fees" once no upfront fee is still Due
 * (also called when a fee is changed on the facility's Fees). Returns how many completed.
 */
async function syncCompletion(loanId) {
  const r = await db.query(
    `UPDATE x SET completed_at = SYSUTCDATETIME()
       OUTPUT INSERTED.extension_id AS id
       FROM portfolio_extensions x
      WHERE x.loan_id = @p0 AND x.status = '${S.APPROVED}' AND x.completed_at IS NULL AND x.flag_deleted = 0
        AND NOT EXISTS (SELECT 1 FROM loan_fees f WHERE f.extension_id = x.extension_id AND f.flag_deleted = 0 AND f.status = 'Due')`,
    [Number(loanId) || 0]);
  return Array.isArray(r) ? r.length : 0;
}

const PAY_METHODS = new Set(['Bank Transfer', 'Card', 'Cheque', 'Cash', 'Other']);

/** Mark an upfront fee of an approved extension Paid (payment schedule). */
async function markFeePaid(id, feeId, body = {}, req) {
  const x = await row(id);
  if (!x) return { ok: false, notFound: true };
  if (x.status !== S.APPROVED) return { ok: false, errors: { status: 'Fees can be marked paid once the extension is approved' } };
  const fees = await db.query(
    'SELECT fee_id, fee_type, amount, status FROM loan_fees WHERE fee_id = @p0 AND extension_id = @p1 AND flag_deleted = 0',
    [Number(feeId) || 0, x.extension_id]);
  const fee = fees[0];
  if (!fee) return { ok: false, notFound: true };
  if (fee.status !== 'Due') return { ok: false, errors: { status: `This fee is ${fee.status}` } };
  const paidOn = iso(body.paid_on);
  const errors = {};
  if (!paidOn) errors.paid_on = 'Payment date is required';
  else if (paidOn > new Date().toISOString().slice(0, 10)) errors.paid_on = 'Payment date cannot be in the future';
  const method = str(body.method, 30);
  if (method && !PAY_METHODS.has(method)) errors.method = 'Invalid payment method';
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.query(
    `UPDATE loan_fees SET status = 'Paid', paid_on = @p1, paid_method = @p2, paid_reference = @p3, paid_by = @p4,
            paid_at = SYSUTCDATETIME(), updated_by = @p4, updated_at = SYSUTCDATETIME()
      WHERE fee_id = @p0`, [fee.fee_id, paidOn, method, str(body.reference, 80), actorId(req)]);
  const completed = (await syncCompletion(x.loan_id)) > 0;
  await writeAudit(req, 'EXTENSION_FEE_PAID', x, { fee_id: fee.fee_id, fee_type: fee.fee_type, amount: num(fee.amount), paid_on: paidOn, completed });
  return { ok: true, completed };
}

/** true when the extension's facility is inside the caller's portfolio scope (null uid = all). */
async function inScope(id, scopeUserId) {
  if (scopeUserId == null) return true;
  const rows = await db.queryNamed(
    `SELECT TOP 1 1 AS ok FROM portfolio_extensions x
       JOIN loans l ON l.loan_id = x.loan_id
       JOIN applications a ON a.application_id = l.application_id
      WHERE x.extension_id = @id AND ${relatedSql('a', 'uid')}`, { id: Number(id) || 0, uid: Number(scopeUserId) || 0 });
  return rows.length > 0;
}

/** Extensions menu list: view = open (in progress) | pending | decided | all. */
async function list(q = {}, { scopeUserId = null } = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const per = Math.min(100, Math.max(1, Number(q.per_page) || 10));
  const p = { off: (page - 1) * per, lim: per };
  let where = 'x.flag_deleted = 0';
  const view = String(q.view || 'open');
  const inList = (arr) => arr.map((s) => `'${s}'`).join(',');
  if (view === 'open') where += ` AND x.status IN (${inList(OPEN)})`;
  else if (view === 'pending') where += ` AND x.status = '${S.PENDING}'`;
  else if (view === 'fees') where += ` AND x.status = '${S.APPROVED}' AND x.completed_at IS NULL`;
  // Approved only once every upfront fee is paid (client 28-10-2026: until then "Awaiting Fees").
  else if (view === 'decided') where += ` AND ((x.status = '${S.APPROVED}' AND x.completed_at IS NOT NULL) OR x.status = '${S.REJECTED}')`;
  else if (view === 'cancelled') where += ` AND x.status = '${S.CANCELLED}'`;
  const search = str(q.search, 120);
  if (search) {
    where += ` AND (${customerNameSql('ap')} LIKE '%' + @search + '%' OR l.loan_number LIKE '%' + @search + '%' OR x.extension_ref LIKE '%' + @search + '%')`;
    p.search = search;
  }
  if (scopeUserId != null) { where += ' AND ' + relatedSql('a', 'scope_uid'); p.scope_uid = Number(scopeUserId) || 0; }
  const rows = await db.queryNamed(`${SELECT_ROW} WHERE ${where}
     ORDER BY CASE WHEN x.status = '${S.PENDING}' THEN 0 WHEN x.status = '${S.APPROVED}' AND x.completed_at IS NULL THEN 1 ELSE 2 END, x.created_at DESC
     OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`, p);
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total FROM (${SELECT_ROW} WHERE ${where}) t`, p);
  const total = cnt[0] ? cnt[0].total : 0;
  return { rows: rows.map(shape), meta: { page, per_page: per, total, total_pages: Math.ceil(total / per) || 1 } };
}

/** Tab counters for the Extensions menu. */
async function counts({ scopeUserId = null } = {}) {
  const inList = (arr) => arr.map((s) => `'${s}'`).join(',');
  const rows = await db.queryNamed(
    `SELECT SUM(CASE WHEN x.status IN (${inList(OPEN)}) THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN x.status = '${S.PENDING}' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN x.status = '${S.APPROVED}' AND x.completed_at IS NULL THEN 1 ELSE 0 END) AS fees_count,
            SUM(CASE WHEN (x.status = '${S.APPROVED}' AND x.completed_at IS NOT NULL) OR x.status = '${S.REJECTED}' THEN 1 ELSE 0 END) AS decided_count,
            SUM(CASE WHEN x.status = '${S.CANCELLED}' THEN 1 ELSE 0 END) AS cancelled_count,
            COUNT(*) AS all_count
       FROM portfolio_extensions x
       JOIN loans l ON l.loan_id = x.loan_id
       JOIN applications a ON a.application_id = l.application_id
      WHERE x.flag_deleted = 0${scopeUserId != null ? ' AND ' + relatedSql('a', 'scope_uid') : ''}`,
    scopeUserId != null ? { scope_uid: Number(scopeUserId) || 0 } : {});
  const r = rows[0] || {};
  return {
    open: Number(r.open_count || 0), pending: Number(r.pending_count || 0), fees: Number(r.fees_count || 0),
    decided: Number(r.decided_count || 0), cancelled: Number(r.cancelled_count || 0), all: Number(r.all_count || 0),
  };
}

/** Extensions of one facility (facility detail > Extension tab). */
async function forLoan(loanId) {
  const rows = await db.query(`${SELECT_ROW} WHERE x.loan_id = @p0 AND x.flag_deleted = 0 ORDER BY x.extension_id DESC`, [Number(loanId) || 0]);
  const out = rows.map(shape);
  // Client 28-10-2026: the facility's Extensions tab shows each approved extension's payment schedule.
  for (const x of out) {
    // eslint-disable-next-line no-await-in-loop
    if (x.status === S.APPROVED) x.payment_schedule = await paymentSchedule(x);
  }
  return out;
}

// ---------------------------------------------------------------- write
async function writeAudit(req, action, x, details = {}) {
  try {
    await audit.write(audit.fromReq(req, {
      action, moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(x.loan_id),
      details: { extension_id: x.extension_id, extension_ref: x.extension_ref, ...details },
    }));
  } catch (e) { console.error('[extension] audit failed: ' + e.message); }
}

/** Raise an extension on an ACTIVE facility (one open extension per facility). */
async function create(loanKey, body = {}, req) {
  const f = await facilityBase(loanKey);
  if (!f) return { ok: false, notFound: true };
  if (f.status !== 'Active') return { ok: false, errors: { loan_id: 'Extensions can only be raised on active facilities' } };
  const open = await db.query(
    `SELECT TOP 1 extension_ref FROM portfolio_extensions WHERE loan_id = @p0 AND flag_deleted = 0 AND status IN (${OPEN.map((s) => `'${s}'`).join(',')})`,
    [f.loan_id]);
  if (open.length) return { ok: false, errors: { loan_id: `Extension ${open[0].extension_ref} is already in progress for this facility` } };

  const months = Number(body.extension_months);
  const base = {
    extension_months: months,
    current_maturity: f.maturity_date,
    gross_amount: num(f.principal),
    net_amount: num(f.net_advance),
    // Client 14-10-2026: a new extension starts with NO pre-filled fee or interest —
    // the user enters them. (Was: rate copied from the loan, fee defaulted to 2%.)
    monthly_rate_pct: 0,
    ext_fee_type: 'PCT', ext_fee_value: 0, ext_fee_timing: 'Upfront', ext_fee_due_date: f.maturity_date,
    doc_fee_type: 'AMOUNT', doc_fee_value: 0, doc_fee_timing: 'Upfront', doc_fee_due_date: f.maturity_date,
    interest_treatment: 'Serviced', monthly_interest: 0, first_payment_date: f.maturity_date,
  };
  const errors = validate(base);
  if (errors) return { ok: false, errors };
  const x = derive(base);
  const paper = await paperDefaults(f, body, actorId(req));
  const out = await db.query(
    `INSERT INTO portfolio_extensions
       (loan_id, status, current_maturity, extension_months, new_maturity, gross_amount, net_amount, monthly_rate_pct,
        ext_fee_type, ext_fee_value, ext_fee_amount, ext_fee_timing, ext_fee_due_date,
        doc_fee_type, doc_fee_value, doc_fee_amount, doc_fee_timing, doc_fee_due_date,
        interest_treatment, monthly_interest, first_payment_date, exit_plan, doc_json, agreement_date, created_by)
     OUTPUT INSERTED.extension_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16, @p17,
             @p18, @p19, @p20, @p21, @p22, CAST(SYSUTCDATETIME() AS date), @p23)`,
    [f.loan_id, S.DRAFT, x.current_maturity, x.extension_months, x.new_maturity, x.gross_amount, x.net_amount, x.monthly_rate_pct,
      x.ext_fee_type, x.ext_fee_value, x.ext_fee_amount, x.ext_fee_timing, x.ext_fee_due_date,
      x.doc_fee_type, x.doc_fee_value, x.doc_fee_amount, x.doc_fee_timing, x.doc_fee_due_date,
      x.interest_treatment, x.monthly_interest, x.first_payment_date, str(body.exit_plan, 8000), JSON.stringify(paper), actorId(req)],
  );
  const id = out[0].id;
  const ref = 'EXT-' + String(id).padStart(6, '0');
  await db.query('UPDATE portfolio_extensions SET extension_ref = @p1, gross_after = @p2, retained_fees = @p3 WHERE extension_id = @p0',
    [id, ref, x.gross_after, x.retained_fees]);
  await writeAudit(req, 'EXTENSION_REQUESTED', { extension_id: id, extension_ref: ref, loan_id: f.loan_id },
    { months: x.extension_months, new_maturity: x.new_maturity });
  return { ok: true, id, ref };
}

/** Save the extension form (terms + paper wording). Only before it is submitted. */
async function update(id, body = {}, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (!EDITABLE.includes(cur.status)) return { ok: false, errors: { status: `A ${cur.status} extension can no longer be changed` } };
  const pick = (k) => (body[k] !== undefined ? body[k] : cur[k]);
  const merged = {
    extension_months: pick('extension_months') != null ? Number(pick('extension_months')) : cur.extension_months,
    current_maturity: iso(cur.current_maturity),
    gross_amount: num(cur.gross_amount), net_amount: num(cur.net_amount), monthly_rate_pct: num(cur.monthly_rate_pct),
    ext_fee_type: String(pick('ext_fee_type') || 'PCT'), ext_fee_value: num(pick('ext_fee_value')),
    ext_fee_timing: String(pick('ext_fee_timing') || 'Upfront'), ext_fee_due_date: iso(pick('ext_fee_due_date')),
    doc_fee_type: String(pick('doc_fee_type') || 'AMOUNT'), doc_fee_value: num(pick('doc_fee_value')),
    doc_fee_timing: String(pick('doc_fee_timing') || 'Upfront'), doc_fee_due_date: iso(pick('doc_fee_due_date')),
    interest_treatment: String(pick('interest_treatment') || 'Serviced'),
    monthly_rate_pct: body.monthly_rate_pct !== undefined ? (body.monthly_rate_pct === '' ? null : num(body.monthly_rate_pct)) : num(cur.monthly_rate_pct),
    monthly_interest: body.monthly_interest !== undefined ? (body.monthly_interest === '' ? null : num(body.monthly_interest)) : num(cur.monthly_interest),
    first_payment_date: iso(pick('first_payment_date')),
    agreement_date: iso(pick('agreement_date')),
  };
  const errors = validate(merged);
  if (errors) return { ok: false, errors };
  const x = derive(merged);
  const paper = { ...parseJson((await db.query('SELECT doc_json FROM portfolio_extensions WHERE extension_id = @p0', [cur.extension_id]))[0].doc_json) };
  if (body.paper && typeof body.paper === 'object') {
    for (const k of PAPER_KEYS) if (body.paper[k] !== undefined) paper[k] = str(body.paper[k], 8000) || '';
  }
  await db.query(
    `UPDATE portfolio_extensions SET
        extension_months = @p1, new_maturity = @p2,
        ext_fee_type = @p3, ext_fee_value = @p4, ext_fee_amount = @p5, ext_fee_timing = @p6, ext_fee_due_date = @p7,
        doc_fee_type = @p8, doc_fee_value = @p9, doc_fee_amount = @p10, doc_fee_timing = @p11, doc_fee_due_date = @p12,
        interest_treatment = @p13, monthly_interest = @p14, first_payment_date = @p15,
        exit_plan = @p16, doc_json = @p17, agreement_date = COALESCE(@p18, agreement_date),
        monthly_rate_pct = @p20, gross_after = @p21, retained_fees = @p22,
        updated_by = @p19, updated_at = SYSUTCDATETIME()
      WHERE extension_id = @p0`,
    [cur.extension_id, x.extension_months, x.new_maturity,
      x.ext_fee_type, x.ext_fee_value, x.ext_fee_amount, x.ext_fee_timing, x.ext_fee_due_date,
      x.doc_fee_type, x.doc_fee_value, x.doc_fee_amount, x.doc_fee_timing, x.doc_fee_due_date,
      x.interest_treatment, x.monthly_interest, x.first_payment_date,
      body.exit_plan !== undefined ? str(body.exit_plan, 8000) : cur.exit_plan, JSON.stringify(paper), x.agreement_date, actorId(req),
      x.monthly_rate_pct != null ? x.monthly_rate_pct : null, x.gross_after, x.retained_fees],
  );
  await writeAudit(req, 'EXTENSION_UPDATED', cur, {
    months: x.extension_months, ext_fee_timing: x.ext_fee_timing, doc_fee_timing: x.doc_fee_timing, retained_fees: x.retained_fees,
  });
  return { ok: true, id: cur.extension_id };
}

/** Everything the two PDFs print: extension row + facility borrower / security. */
async function pdfInput(id) {
  const r = await row(id);
  if (!r) return null;
  const f = await facilityBase(r.loan_id);
  const paper = parseJson(r.doc_json);
  const { address, secs } = await paperAddress(paper, f);
  const x = {
    ...r,
    borrower_name: paper.borrower_name || r.customer_name,
    security_address: address,
    security_lines: address.split('\n').map((s) => s.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean),
    security_maps: secs,
    underwriter_name: (f && f.underwriter_name) || '',
    introducer: f && f.broker_name ? { name: f.broker_name, email: f.broker_email, phone: f.broker_phone } : null,
    original_date: r.loan_start_date,
    agreement_date: r.agreement_date || new Date().toISOString().slice(0, 10),
  };
  return { r, x, paper, f };
}

async function agreementPdf(id) {
  const inp = await pdfInput(id);
  if (!inp) return null;
  const buf = await pdf.buildExtensionAgreementPdf(inp.x);
  const fileName = `Extension Agreement - ${inp.r.loan_number} - ${inp.x.borrower_name}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
  return { buf, fileName, inp };
}

async function requestPdf(id) {
  const inp = await pdfInput(id);
  if (!inp) return null;
  const buf = await pdf.buildExtensionRequestPdf({ ...inp.x, product: inp.f && inp.f.product }, inp.paper);
  const fileName = `Extension Request - ${inp.r.extension_ref} - ${inp.x.borrower_name}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
  return { buf, fileName, inp };
}

/** Save a generated / uploaded file on the facility's application and link it to the extension. */
async function attach(x, kind, fileName, buf, req) {
  const typeId = await docTypeId(DOC_KINDS[kind] || DOC_KINDS.OTHER);
  const saved = await application.addDocument(x.application_id, {
    file_name: fileName, content_base64: buf.toString('base64'), document_type_id: typeId,
  }, req);
  if (!saved || !saved.ok) throw new Error((saved && saved.errors && Object.values(saved.errors)[0]) || 'Document could not be saved');
  await db.query(
    'INSERT INTO portfolio_extension_documents (extension_id, app_document_id, kind, created_by) VALUES (@p0, @p1, @p2, @p3)',
    [x.extension_id, saved.id, kind, actorId(req)]);
  return saved.id;
}

/**
 * Generate the Extension Agreement, save it on the facility and (unless send_email = false)
 * e-mail it to the borrower for signature. Status -> Agreement Sent.
 */
async function sendAgreement(id, body = {}, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (!EDITABLE.includes(cur.status)) return { ok: false, errors: { status: `A ${cur.status} extension can no longer be changed` } };
  if (!(Number(cur.extension_months) > 0) || !cur.new_maturity) return { ok: false, errors: { extension_months: 'Set the extension length first' } };
  const email = body.send_email !== false && body.send_email !== 'false';
  const to = str(body.to, 320) || cur.broker_email || cur.customer_email;
  if (email && !(to && to.includes('@'))) return { ok: false, errors: { to: 'Borrower e-mail address is required' } };

  if (!cur.agreement_date) await db.query('UPDATE portfolio_extensions SET agreement_date = CAST(SYSUTCDATETIME() AS date) WHERE extension_id = @p0', [cur.extension_id]);
  const built = await agreementPdf(cur.extension_id);
  const docId = await attach(cur, 'AGREEMENT', built.fileName, built.buf, req);

  let sent = { ok: !email, error: undefined };
  if (email) {
    const first = String(built.inp.x.borrower_name || '').split(' ')[0] || 'there';
    const note = str(body.message, 4000);
    // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
    const mailVars = {
      Ref: cur.extension_ref || cur.loan_number, LoanNumber: cur.loan_number, Borrower: built.inp.x.borrower_name,
      RecipientName: first, NewMaturity: pdf.longDate(cur.new_maturity), Notes: note,
      NotesBlock: note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : '',
    };
    const { subject, html } = emailHub.render('EXTENSION_AGREEMENT', mailVars);
    sent = await mail.sendMail({
      // Email Settings master + Email History (client 17-10-2026)
      event: 'EXTENSION_AGREEMENT', ref: { module: 'EXTENSION', id: cur.extension_id, number: cur.extension_ref || cur.loan_number }, req,
      vars: mailVars,
      to,
      cc: str(body.cc, 320) || undefined,
      subject,
      html,
      attachments: [{ filename: built.fileName, buffer: built.buf, contentType: 'application/pdf' }],
    });
  }
  // Status moves on when the borrower actually has the agreement (e-mailed, or sent by hand).
  if (sent.ok) {
    await db.query(
      `UPDATE portfolio_extensions SET agreement_document_id = @p1, agreement_sent_to = @p2, agreement_sent_at = SYSUTCDATETIME(),
              status = CASE WHEN status = '${S.DRAFT}' THEN '${S.SENT}' ELSE status END,
              updated_by = @p3, updated_at = SYSUTCDATETIME()
        WHERE extension_id = @p0`,
      [cur.extension_id, docId, email ? to : 'Sent manually', actorId(req)]);
  } else {
    await db.query('UPDATE portfolio_extensions SET agreement_document_id = @p1 WHERE extension_id = @p0', [cur.extension_id, docId]);
  }
  await writeAudit(req, sent.ok ? 'EXTENSION_AGREEMENT_SENT' : 'EXTENSION_AGREEMENT_SEND_FAILED', cur,
    { to: email ? to : 'manual', document_id: docId, error: sent.ok ? undefined : sent.error });
  return { ok: true, emailed: email && sent.ok, error: sent.ok ? undefined : sent.error, document_id: docId };
}

/** Upload the signed agreement / exit evidence. A signed agreement moves the status on. */
async function uploadDocument(id, body = {}, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (!EDITABLE.includes(cur.status)) return { ok: false, errors: { status: `A ${cur.status} extension can no longer be changed` } };
  const kind = String(body.kind || 'EXIT_EVIDENCE').toUpperCase();
  if (!UPLOAD_KINDS.has(kind)) return { ok: false, errors: { kind: 'Unknown document kind' } };
  const name = str(body.file_name, 250);
  const b64 = String(body.content_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!name || !b64) return { ok: false, errors: { file: 'Choose a file to upload' } };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { ok: false, errors: { file: 'File is empty' } };
  const docId = await attach(cur, kind, name, buf, req);
  if (kind === 'SIGNED_AGREEMENT') {
    await db.query(
      `UPDATE portfolio_extensions SET signed_document_id = @p1, status = '${S.SIGNED}', updated_by = @p2, updated_at = SYSUTCDATETIME()
        WHERE extension_id = @p0`, [cur.extension_id, docId, actorId(req)]);
  }
  await writeAudit(req, kind === 'SIGNED_AGREEMENT' ? 'EXTENSION_SIGNED_UPLOADED' : 'EXTENSION_DOC_UPLOADED', cur, { document_id: docId, kind });
  return { ok: true, id: docId };
}

async function deleteDocument(id, docId, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (!EDITABLE.includes(cur.status)) return { ok: false, errors: { status: `A ${cur.status} extension can no longer be changed` } };
  const link = await db.query(
    'SELECT ext_doc_id, kind FROM portfolio_extension_documents WHERE extension_id = @p0 AND app_document_id = @p1 AND flag_deleted = 0',
    [cur.extension_id, Number(docId) || 0]);
  if (!link.length) return { ok: false, notFound: true };
  await db.query('UPDATE portfolio_extension_documents SET flag_deleted = 1 WHERE ext_doc_id = @p0', [link[0].ext_doc_id]);
  await application.deleteDocument(cur.application_id, Number(docId), req);
  if (Number(cur.signed_document_id) === Number(docId)) {
    await db.query(
      `UPDATE portfolio_extensions SET signed_document_id = NULL,
              status = CASE WHEN agreement_sent_at IS NOT NULL THEN '${S.SENT}' ELSE '${S.DRAFT}' END,
              updated_by = @p1, updated_at = SYSUTCDATETIME()
        WHERE extension_id = @p0`, [cur.extension_id, actorId(req)]);
  }
  if (Number(cur.agreement_document_id) === Number(docId)) {
    await db.query('UPDATE portfolio_extensions SET agreement_document_id = NULL WHERE extension_id = @p0', [cur.extension_id]);
  }
  await writeAudit(req, 'EXTENSION_DOC_DELETED', cur, { document_id: Number(docId), kind: link[0].kind });
  return { ok: true };
}

async function documentFile(id, docId) {
  const rows = await db.query(
    `SELECT d.file_name, d.file_path FROM portfolio_extension_documents xd
       JOIN application_documents d ON d.app_document_id = xd.app_document_id AND d.flag_deleted = 0
      WHERE xd.extension_id = @p0 AND xd.app_document_id = @p1 AND xd.flag_deleted = 0`,
    [Number(id) || 0, Number(docId) || 0]);
  return rows[0] || null;
}

/** Active users whose role holds Head of Extension (primary or extra role), one per e-mail. */
async function headOfExtensionUsers() {
  const rows = await db.query(
    `SELECT DISTINCT u.user_id, u.full_name, u.email
       FROM users u
      WHERE u.flag_deleted = 0 AND u.is_active = 1
        AND EXISTS (
          SELECT 1 FROM role_permissions rp
            JOIN permissions p ON p.permission_id = rp.permission_id
            JOIN roles r ON r.role_id = rp.role_id AND r.flag_deleted = 0 AND r.is_active = 1
           WHERE p.module_key = @p0 AND p.permission_key = 'view'
             AND (rp.role_id = u.role_id OR rp.role_id IN (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.user_id)))`,
    [HEAD_MODULE]);
  const seen = new Set();
  return rows.filter((r) => {
    const em = String(r.email || '').trim().toLowerCase();
    if (!em.includes('@') || seen.has(em)) return false;
    seen.add(em);
    return true;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who the Extension Request goes to (client 27-10-2026): the Head of Extension users ticked
 * in the Send popup (body.heads = user ids) + any addresses typed by hand (body.to, comma /
 * semicolon separated). Nothing chosen -> error, nothing is sent.
 */
function pickRecipients(heads, body = {}) {
  const ids = new Set((Array.isArray(body.heads) ? body.heads : []).map(Number));
  const picked = heads.filter((h) => ids.has(Number(h.user_id)));
  const typed = String(body.to || '').split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
  const invalid = typed.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) return { error: `Not a valid e-mail address: ${invalid.join(', ')}` };
  const seen = new Set(picked.map((h) => h.email.toLowerCase()));
  const manual = typed.filter((e) => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase())).map((email) => ({ email, full_name: '' }));
  const recipients = [...picked, ...manual];
  if (!recipients.length) return { error: 'Tick a Head of Extension or type an e-mail address' };
  return { recipients, picked };
}

/**
 * Submit to the Head of Extension: needs the signed agreement. Builds the Extension Request
 * paper, saves it, e-mails it (one e-mail per chosen recipient) and notifies the chosen heads.
 */
async function submit(id, body = {}, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (cur.status !== S.SIGNED || !cur.signed_document_id) {
    return { ok: false, errors: { status: 'Upload the signed Extension Agreement before sending to the Head of Extension' } };
  }
  const heads = await headOfExtensionUsers();
  const pick = pickRecipients(heads, body);
  if (pick.error) return { ok: false, errors: { to: pick.error } };
  const { recipients, picked } = pick;
  const built = await requestPdf(cur.extension_id);
  const docId = await attach(cur, 'REQUEST_PAPER', built.fileName, built.buf, req);
  await db.query(
    `UPDATE portfolio_extensions SET status = '${S.PENDING}', request_document_id = @p1, submitted_by = @p2, submitted_at = SYSUTCDATETIME(),
            updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE extension_id = @p0`, [cur.extension_id, docId, actorId(req)]);

  const link = String(config.frontUrl || '').replace(/\/?$/, '/') + 'extensions/' + cur.extension_id;
  const note = str(body.message, 4000);
  const ccOverride = str(body.cc, 400);
  const results = [];
  for (const [i, h] of recipients.entries()) {
    // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
    const mailVars = {
      Ref: cur.extension_ref, LoanNumber: cur.loan_number, Borrower: built.inp.x.borrower_name,
      RecipientName: h.full_name || '', RecipientFirstName: String(h.full_name || '').split(' ')[0] || 'there',
      ExtensionMonths: cur.extension_months, NewMaturity: pdf.longDate(cur.new_maturity), GrossLoan: gbp(cur.gross_amount),
      Notes: note, Link: link,
      NotesBlock: note ? `<p style="margin-top:14px"><b>Notes:</b><br>${esc(note).replace(/\n/g, '<br>')}</p>` : '',
    };
    const { subject, html } = emailHub.render('EXTENSION_REQUEST', mailVars);
    // eslint-disable-next-line no-await-in-loop
    const r = await mail.sendMail({
      // Email Settings master + Email History (client 17-10-2026). Extra CC on the first copy only.
      event: 'EXTENSION_REQUEST', ref: { module: 'EXTENSION', id: cur.extension_id, number: cur.extension_ref }, req, applyRules: i === 0,
      vars: mailVars,
      to: h.email,
      cc: ccOverride || undefined,
      subject,
      html,
      attachments: [{ filename: built.fileName, buffer: built.buf, contentType: 'application/pdf' }],
    });
    results.push({ email: h.email, ok: !!r.ok, error: r.ok ? undefined : r.error });
  }
  try {
    if (picked.length) {
      await notifications.createMany(picked.map((h) => h.user_id), {
        title: `Extension request: ${cur.extension_ref} – ${built.inp.x.borrower_name}`,
        body: 'Extension ready for approval. Request paper e-mailed.',
        type: 'EXTENSION_REQUEST', link: '/extensions/' + cur.extension_id, entityId: cur.extension_id,
      }, actorId(req));
    }
  } catch (e) { console.error('[extension] notification failed: ' + e.message); }
  const okList = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  await writeAudit(req, 'EXTENSION_SUBMITTED', cur, { document_id: docId, sent_to: okList.map((r) => r.email), failed: bad.length ? bad : undefined });
  return {
    ok: true, sentTo: okList.length, heads: picked.length,
    error: bad.length ? bad.map((b) => `${b.email}: ${b.error}`).join('; ') : undefined,
  };
}

/**
 * Approved -> move the facility: maturity + term, new schedule rows for the extension months,
 * extension / document fees raised on the facility (Fees).
 * Client 28-10-2026: Retained fees are added to the facility's gross (loans.principal) and
 * outstanding - the Portfolio list / header follow - and kept on Fees as 'Capitalised';
 * Upfront fees are raised Due for collection. Returns { retained, upfront }.
 */
async function applyToLoan(x, req) {
  const uid = actorId(req);
  const months = Number(x.extension_months) || 0;
  const mi = num(x.monthly_interest) || 0;
  await db.query(
    `UPDATE loans SET maturity_date = @p1, term_months = COALESCE(term_months, 0) + @p2, updated_by = @p3, updated_at = SYSUTCDATETIME()
      WHERE loan_id = @p0`, [x.loan_id, x.new_maturity, months, uid]);
  const retained = retainedFees(x);
  if (retained > 0) {
    await db.query(
      `UPDATE loans SET principal = COALESCE(principal, 0) + @p1,
              outstanding_balance = COALESCE(outstanding_balance, principal, 0) + @p1,
              updated_by = @p2, updated_at = SYSUTCDATETIME()
        WHERE loan_id = @p0`, [x.loan_id, retained, uid]);
  }
  const last = await db.query('SELECT ISNULL(MAX(installment_no), 0) AS n FROM loan_schedules WHERE loan_id = @p0', [x.loan_id]);
  let n = Number(last[0].n) || 0;
  for (let k = 1; k <= months; k += 1) {
    n += 1;
    const interest = x.interest_treatment === 'Retained' ? (k === months ? round2(mi * months) : 0) : mi;
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `INSERT INTO loan_schedules (loan_id, installment_no, due_date, principal_due, interest_due, total_due, status, created_by)
       VALUES (@p0, @p1, @p2, 0, @p3, @p3, 'Due', @p4)`,
      [x.loan_id, n, addMonths(x.current_maturity, k), interest, uid]);
  }
  const fee = async (type, amount, timing, due, label) => {
    if (!(num(amount) > 0)) return;
    const kept = timing === 'Retained';
    await db.query(
      `INSERT INTO loan_fees (loan_id, fee_type, amount, due_date, status, notes, created_by, extension_id)
       VALUES (@p0, @p1, @p2, @p3, @p6, @p4, @p5, @p7)`,
      [x.loan_id, type, num(amount), kept ? x.new_maturity : (iso(due) || x.current_maturity),
        `${label} – ${x.extension_ref}${kept ? ' (retained – added to gross loan)' : ' (paid upfront)'}`, uid,
        kept ? 'Capitalised' : 'Due', x.extension_id]);
  };
  await fee('Extension', x.ext_fee_amount, x.ext_fee_timing, x.ext_fee_due_date, 'Extension fee');
  await fee('Document', x.doc_fee_amount, x.doc_fee_timing, x.doc_fee_due_date, 'Extension documentation fee');
  return { retained, upfront: upfrontFees(x) };
}

/** Head of Extension decision: approve | reject. */
async function decide(id, body = {}, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (cur.status !== S.PENDING) return { ok: false, errors: { status: 'Only an extension pending approval can be decided' } };
  const decision = String(body.decision || '').toLowerCase();
  if (!['approve', 'reject'].includes(decision)) return { ok: false, errors: { decision: 'Decision must be approve or reject' } };
  const notes = str(body.notes, 4000);
  if (decision === 'reject' && !notes) return { ok: false, errors: { notes: 'Give a reason for rejecting' } };
  let applied = null;
  if (decision === 'approve') {
    if (cur.loan_status !== 'Active') return { ok: false, errors: { status: `Facility is ${cur.loan_status}; only active facilities can be extended` } };
    applied = await applyToLoan(cur, req);
  }
  const status = decision === 'approve' ? S.APPROVED : S.REJECTED;
  await db.query(
    `UPDATE portfolio_extensions SET status = @p1, decision = @p1, decision_notes = @p2, decided_by = @p3, decided_at = SYSUTCDATETIME(),
            applied_at = CASE WHEN @p1 = '${S.APPROVED}' THEN SYSUTCDATETIME() ELSE applied_at END,
            updated_by = @p3, updated_at = SYSUTCDATETIME()
      WHERE extension_id = @p0`, [cur.extension_id, status, notes, actorId(req)]);
  // No upfront fee to collect -> straight back to the portfolio; else "Awaiting Fees".
  if (applied && !(applied.upfront > 0)) {
    await db.query('UPDATE portfolio_extensions SET completed_at = SYSUTCDATETIME() WHERE extension_id = @p0', [cur.extension_id]);
  }
  await writeAudit(req, decision === 'approve' ? 'EXTENSION_APPROVED' : 'EXTENSION_REJECTED', cur, {
    notes: notes || undefined,
    new_maturity: decision === 'approve' ? cur.new_maturity : undefined,
    retained_fees: applied && applied.retained > 0 ? applied.retained : undefined,
    upfront_fees: applied && applied.upfront > 0 ? applied.upfront : undefined,
  });
  try {
    const to =(await db.query('SELECT created_by, submitted_by FROM portfolio_extensions WHERE extension_id = @p0', [cur.extension_id]))[0] || {};
    const ids = [...new Set([to.created_by, to.submitted_by].filter(Boolean))];
    if (ids.length) {
      await notifications.createMany(ids, {
        title: `Extension ${status.toLowerCase()}: ${cur.extension_ref}`,
        body: decision === 'approve'
          ? `Facility ${cur.loan_number} extended to ${pdf.longDate(cur.new_maturity)}.${applied && applied.upfront > 0 ? ` Collect the upfront fees (${gbp(applied.upfront)}) and mark them paid on the extension.` : ''}`
          : `Reason: ${notes}`,
        type: 'EXTENSION_DECISION', link: '/extensions/' + cur.extension_id, entityId: cur.extension_id,
      }, actorId(req));
    }
  } catch (e) { console.error('[extension] notification failed: ' + e.message); }
  return { ok: true, status, awaitingFees: !!(applied && applied.upfront > 0) };
}

async function cancel(id, body = {}, req) {
  const cur = await row(id);
  if (!cur) return { ok: false, notFound: true };
  if (!EDITABLE.includes(cur.status)) return { ok: false, errors: { status: `A ${cur.status} extension cannot be cancelled` } };
  await db.query(
    `UPDATE portfolio_extensions SET status = '${S.CANCELLED}', decision_notes = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE extension_id = @p0`, [cur.extension_id, str(body.reason, 4000), actorId(req)]);
  await writeAudit(req, 'EXTENSION_CANCELLED', cur, { reason: str(body.reason, 500) || undefined });
  return { ok: true };
}

module.exports = {
  S, OPEN, EDITABLE, MODULE_KEY, HEAD_MODULE,
  list, counts, get, forLoan, inScope, create, update, sendAgreement, uploadDocument, deleteDocument, documentFile,
  agreementPdf, requestPdf, submit, decide, cancel, headOfExtensionUsers, addMonths,
  markFeePaid, syncCompletion, paymentSchedule, derive, PAY_METHODS,
};
