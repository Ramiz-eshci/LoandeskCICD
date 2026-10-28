'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('../config/database');
const audit = require('./audit.service');
const notifications = require('./notification.service');
const application = require('./application.service');
const enquiry = require('./enquiry.service');
const extensionSvc = require('./extension.service');
const fp = require('./facilityPosition.service');
// Lazy: redemption.service is only needed for payment caps / redeem.
const redemptionSvc = () => require('./redemption.service');
const { config } = require('../config/env');
const { getGraphClient } = require('../config/microsoftGraph.service');
const contactCfg = require('../config/portfolioContact.config');
const { textError } = require('../utils/textRules');
const { latestGrossApply, appNetSql } = require('../utils/loanAmount');
const { relatedSql } = require('../middlewares/portfolio-scope');

/** ' AND <related to @scope_uid>' when scoped (Portfolio List / Customer List only), else ''. */
function scopeAnd(scopeUserId, p) {
  if (scopeUserId == null) return '';
  p.scope_uid = Number(scopeUserId) || 0;
  return ' AND ' + relatedSql('a', 'scope_uid');
}

/** Client 23-10-2026 (option A): what the borrower owes in the normal course = the GROSS loan
 *  (incl. agreed drawdowns, retained interest, fees). Outstanding = gross - payments; when it
 *  reaches 0 the facility is Completed. Redeem Facility is only for an early close. */
const grossOutstanding = (pos) => pos.grossOutstanding;

const MODULE_KEY = 'PORTFOLIO.CONTACT_LOG';
const METHODS = new Set(['Phone', 'Email', 'SMS', 'Meeting']);
const STATUSES = new Set(['Pending', 'Done', 'Overdue', 'Skipped']);
const REQUEST_TYPES = new Set(['Extension', 'Further Advance']);
const PAYMENT_METHODS = new Set(['Bank Transfer', 'Direct Debit', 'Standing Order', 'Cash', 'Cheque', 'Internal Transfer', 'Other']);
const FEE_TYPES = new Set(['Arrangement', 'Broker', 'Document', 'Extension', 'Exit', 'Late', 'Default', 'Other']);
/**
 * Facility (loans.status) lifecycle, client 30-09-2026:
 *   Active       live book (Portfolio > Live Facilities tab)
 *   Bad Debt     gone bad, still being recovered (note + money received in instalments)
 *   Written Off  no hope of return - removed from the book, loss accepted
 *   Recovered    bad debt closed with the full amount received
 *   Redeemed     completed / repaid
 * Everything is listed under Portfolio > All Facilities (filter by status).
 */
const LOAN_STATUSES = ['Active', 'Bad Debt', 'Written Off', 'Recovered', 'Redeemed'];
// 'Capitalised' (client 28-10-2026): a retained extension fee already added to the gross loan.
const FEE_STATUSES = new Set(['Due', 'Paid', 'Waived', 'Capitalised']);
const DRAWDOWN_STATUSES = new Set(['Released', 'Scheduled']);
const COVENANT_STATUSES = new Set(['Upcoming', 'Future', 'Complied', 'Overdue', 'Breached', 'Waived']);

/**
 * Contact-log dropdown values, from the admin-managed master tables.
 * Falls back gracefully (empty arrays) if the tables are not migrated yet.
 */
async function contactLookups() {
  const [methods, statuses, outcomes] = await Promise.all([
    db.query('SELECT name FROM contact_methods WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order, name'),
    db.query('SELECT name FROM followup_statuses WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order, name'),
    db.query('SELECT name FROM contact_outcomes WHERE flag_deleted = 0 AND is_active = 1 ORDER BY sort_order, name'),
  ]);
  return {
    methods: methods.map((r) => r.name),
    followupStatuses: statuses.map((r) => r.name),
    contactOutcomes: outcomes.map((r) => r.name),
  };
}

/** Allowed method/status sets for validation; null if masters unavailable. */
async function contactAllowed() {
  try {
    const v = await contactLookups();
    return { methods: v.methods, statuses: v.followupStatuses };
  } catch (_) {
    return null;
  }
}

function actorId(req) {
  return req && req.userData ? req.userData.userId : null;
}

function str(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function date(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function bool(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function customerNameSql(alias) {
  return `COALESCE(NULLIF(${alias}.company_name, ''), LTRIM(RTRIM(CONCAT(COALESCE(${alias}.first_name, ''), ' ', COALESCE(${alias}.last_name, '')))), ${alias}.email, 'Customer')`;
}

function gbp(v) {
  return Number(v || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pdfBuffer(lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(18).text('Redemption Statement');
    doc.moveDown();
    doc.font('Helvetica').fontSize(11);
    lines.forEach(([k, v]) => doc.text(`${k}: ${v}`));
    doc.end();
  });
}

/** Contact Schedule milestone (months after start) a log is tied to; null = none. */
function milestoneMonth(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 600 ? n : null;
}

async function liveLoanContext({ loanId, applicationId, applicantId }) {
  const rows = await db.queryNamed(
    `SELECT TOP 1
            l.loan_id, l.loan_number, l.application_id, l.status AS loan_status,
            a.application_ref, aa.applicant_id,
            ${customerNameSql('ap')} AS customer_name
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
      WHERE l.flag_deleted = 0
        AND l.status = 'Active'
        AND (@loanId IS NULL OR l.loan_id = @loanId)
        AND (@applicationId IS NULL OR l.application_id = @applicationId)
        AND (@applicantId IS NULL OR aa.applicant_id = @applicantId)
      ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id`,
    {
      loanId: loanId || null,
      applicationId: applicationId || null,
      applicantId: applicantId || null,
    },
  );
  return rows[0] || null;
}

function validate(body, partial = false, allowed = null, current = null) {
  const errors = {};
  // Masters available -> only ACTIVE master values are accepted (even if none are active).
  // Hard-coded sets only when the master tables could not be read.
  const methodSet = allowed && allowed.methods ? new Set(allowed.methods) : METHODS;
  const statusSet = allowed && allowed.statuses ? new Set(allowed.statuses) : STATUSES;
  if (!partial || body.loan_id !== undefined) {
    if (!Number(body.loan_id)) errors.loan_id = 'Facility is required';
  }
  if (!partial || body.applicant_id !== undefined) {
    if (!Number(body.applicant_id)) errors.applicant_id = 'Customer is required';
  }
  if (!partial || body.contact_date !== undefined) {
    if (!date(body.contact_date)) errors.contact_date = 'Contact date is required';
  }
  if (!partial || body.person !== undefined) {
    if (!str(body.person, 200)) errors.person = 'Person is required';
    else {
      // Tester 20-10-2026: person name must not take special characters.
      const nm = textError(body.person, 'name');
      if (nm) errors.person = nm;
    }
  }
  // Tester 20-10-2026: follow-up date cannot be in the past (an unchanged old date on edit is fine).
  if (body.followup_date) {
    const fd = String(body.followup_date).slice(0, 10);
    const was = current && current.followup_date
      ? (current.followup_date instanceof Date ? current.followup_date.toISOString().slice(0, 10) : String(current.followup_date).slice(0, 10))
      : null;
    if (fd < ukToday() && fd !== was) errors.followup_date = 'Follow-up date cannot be in the past';
  }
  if (!partial || body.method !== undefined) {
    const method = str(body.method, 30);
    if (!method || !methodSet.has(method)) errors.method = 'Select a valid contact method';
  }
  if (body.followup_status !== undefined) {
    const status = str(body.followup_status, 30) || 'Pending';
    if (!statusSet.has(status)) errors.followup_status = 'Invalid follow up status';
  }
  return Object.keys(errors).length ? errors : null;
}

async function maybeCreateOutlookEvent(ctx, body) {
  if (!bool(body.outlook_reminder) || !body.followup_date) return null;
  const g = config.graph;
  if (!(g.tenantId && g.clientId && g.clientSecret && g.mailbox)) return null;

  const graph = getGraphClient();
  const day = date(body.followup_date);
  const event = {
    subject: `Follow up: ${str(body.person, 120)} - ${ctx.application_ref || ctx.loan_number}`,
    body: { contentType: 'text', content: str(body.contact_notes, 1000) || 'Portfolio customer follow-up.' },
    start: { dateTime: `${day}T09:00:00`, timeZone: 'UTC' },
    end: { dateTime: `${day}T09:30:00`, timeZone: 'UTC' },
  };
  const created = await graph.api(`/users/${g.mailbox}/events`).post(event);
  return created && created.id ? String(created.id).slice(0, 200) : null;
}

async function listContacts(q = {}) {
  const p = {
    search: str(q.search, 100),
    method: str(q.method, 30),
    outcome: str(q.outcome, 50),
    status: str(q.status, 30),
    loanId: Number(q.loan_id) || null,
    applicantId: Number(q.applicant_id) || null,
  };
  return db.queryNamed(
    `SELECT pcl.log_id, pcl.loan_id, l.loan_number, pcl.application_id, a.application_ref,
            pcl.applicant_id, ${customerNameSql('ap')} AS customer_name,
            CONVERT(varchar(10), pcl.contact_date, 23) AS contact_date,
            pcl.person, pcl.method, pcl.contact_notes,
            CONVERT(varchar(10), pcl.followup_date, 23) AS followup_date,
            pcl.outlook_reminder, pcl.outlook_event_id, pcl.followup_status, pcl.contact_outcome,
            pcl.milestone_month, pcl.created_at, pcl.updated_at
       FROM portfolio_contact_logs pcl
       JOIN loans l ON l.loan_id = pcl.loan_id
       JOIN applications a ON a.application_id = pcl.application_id
       JOIN applicants ap ON ap.applicant_id = pcl.applicant_id
      WHERE pcl.flag_deleted = 0
        AND (@loanId IS NULL OR pcl.loan_id = @loanId)
        AND (@applicantId IS NULL OR pcl.applicant_id = @applicantId)
        AND (@method IS NULL OR pcl.method = @method)
        AND (@outcome IS NULL OR pcl.contact_outcome = @outcome)
        AND (@status IS NULL OR pcl.followup_status = @status)
        AND (@search IS NULL OR ${customerNameSql('ap')} LIKE '%' + @search + '%'
          OR l.loan_number LIKE '%' + @search + '%'
          OR a.application_ref LIKE '%' + @search + '%'
          OR pcl.person LIKE '%' + @search + '%'
          OR pcl.contact_notes LIKE '%' + @search + '%')
      ORDER BY pcl.contact_date DESC, pcl.log_id DESC`,
    p,
  );
}

async function liveFacilities({ scopeUserId = null } = {}) {
  const sp = {};
  const scope = scopeAnd(scopeUserId, sp);
  return db.queryNamed(
    `SELECT l.loan_id, l.loan_number, l.application_id, a.application_ref,
            aa.applicant_id, ${customerNameSql('ap')} AS customer_name,
            p.name AS product, l.principal, l.rate_pct, l.outstanding_balance,
            CONVERT(varchar(10), l.start_date, 23) AS start_date,
            CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
            l.status,
            COALESCE(ar.arrears_amount, 0) AS arrears_amount
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       LEFT JOIN products p ON p.product_id = a.product_id
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       LEFT JOIN (
         SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount
           FROM collections
          WHERE flag_deleted = 0 AND status <> 'Closed'
          GROUP BY loan_id
       ) ar ON ar.loan_id = l.loan_id
      WHERE l.flag_deleted = 0 AND l.status = 'Active'${scope}
      ORDER BY ${customerNameSql('ap')}, l.loan_number`,
    sp,
  );
}

function pageParams(q) {
  const page = Math.max(1, Number(q.page) || 1);
  const per = Math.min(100, /* pagination back on (client 20-10-2026) */ Math.max(1, Number(q.per_page) || 10));
  return { page, per, off: (page - 1) * per, lim: per };
}
function pageMeta(page, per, total) {
  return { page, per_page: per, total, total_pages: Math.ceil(total / per) || 1 };
}

/**
 * Server-paged, server-filtered facilities for the Portfolio list.
 *   scope=live (default)  Live Facilities tab - Active only
 *   scope=all             All Facilities tab  - every status (bad debt, written off, completed...),
 *                         optional status=<one of LOAN_STATUSES> filter
 *   scope=completed       Redeemed Facilities tab - Redeemed only (client 26-10-2026)
 */
async function liveFacilitiesPaged(q = {}, { scopeUserId = null } = {}) {
  const { page, per, off, lim } = pageParams(q);
  const p = { off, lim };
  let where = 'l.flag_deleted = 0';
  if (String(q.scope || 'live') === 'all') {
    const st = str(q.status, 30);
    if (st && LOAN_STATUSES.includes(st)) { where += ' AND l.status = @st'; p.st = st; }
  } else if (String(q.scope) === 'completed') {
    // Client 26-10-2026: Redeemed Facilities tab - redeemed loans only.
    where += " AND l.status = 'Redeemed'";
  } else {
    where += " AND l.status = 'Active'";
  }
  where += scopeAnd(scopeUserId, p);
  const search = str(q.search, 120);
  if (search) {
    where += ` AND (${customerNameSql('ap')} LIKE '%' + @search + '%' OR l.loan_number LIKE '%' + @search + '%' OR p.name LIKE '%' + @search + '%')`;
    p.search = search;
  }
  const days = Number(q.maturing_days) || 0;
  if (days > 0) {
    where += ' AND l.maturity_date IS NOT NULL AND l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, @days, CAST(GETUTCDATE() AS date))';
    p.days = days;
  }
  if (String(q.arrears) === '1' || String(q.arrears) === 'true') {
    where += ' AND COALESCE(ar.arrears_amount, 0) > 0';
  }
  // Client 12-10-2026: the "Today" tab — facilities with a contact check-in due, or whose
  // maturity is today (Payment) or already passed (Overdue). Client 27-10-2026: not month
  // wise - the borrower pays on the maturity date, so the monthly schedule plays no part.
  if (String(q.due_today) === '1' || String(q.due_today) === 'true') {
    where += ` AND (
      EXISTS (SELECT 1 FROM portfolio_contact_logs pcl2 WHERE pcl2.loan_id = l.loan_id AND pcl2.flag_deleted = 0 AND pcl2.followup_status = 'Pending' AND pcl2.followup_date <= CAST(GETUTCDATE() AS date))
      OR (l.maturity_date IS NOT NULL AND l.maturity_date <= CAST(GETUTCDATE() AS date)))`;
  }
  const FROM = `FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       LEFT JOIN products p ON p.product_id = a.product_id
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       LEFT JOIN (SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount FROM collections WHERE flag_deleted = 0 AND status <> 'Closed' GROUP BY loan_id) ar ON ar.loan_id = l.loan_id
      WHERE ${where}`;
  const rows = await db.queryNamed(
    `SELECT l.loan_id, l.loan_number, l.application_id, a.application_ref,
            aa.applicant_id, ${customerNameSql('ap')} AS customer_name,
            p.name AS product, l.principal, l.rate_pct, l.outstanding_balance,
            CONVERT(varchar(10), l.start_date, 23) AS start_date,
            CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
            -- Client 12-10-2026: dashboard prompts are TODAY-based. Client 27-10-2026: Payment is
            -- due ON the maturity date (not month wise); once it has passed it is Overdue.
            CASE WHEN l.maturity_date = CAST(GETUTCDATE() AS date)
                 THEN CONVERT(varchar(10), l.maturity_date, 23) ELSE NULL END AS next_payment_due,
            (SELECT CONVERT(varchar(10), MIN(pcl.followup_date), 23) FROM portfolio_contact_logs pcl
               WHERE pcl.loan_id = l.loan_id AND pcl.flag_deleted = 0 AND pcl.followup_status = 'Pending'
                 AND pcl.followup_date <= CAST(GETUTCDATE() AS date)) AS next_contact_due,
            CASE WHEN l.maturity_date < CAST(GETUTCDATE() AS date)
                 THEN CONVERT(varchar(10), l.maturity_date, 23) ELSE NULL END AS redemption_due,
            l.status, COALESCE(ar.arrears_amount, 0) AS arrears_amount,
            l.write_off_amount, CONVERT(varchar(10), l.written_off_at, 23) AS written_off_at,
            CONVERT(varchar(10), l.bad_debt_at, 23) AS bad_debt_at,
            (SELECT COALESCE(SUM(r.amount), 0) FROM loan_recoveries r WHERE r.loan_id = l.loan_id AND r.flag_deleted = 0) AS recovered_amount
       ${FROM}
      ORDER BY l.loan_id DESC
      OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`, p);
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total ${FROM}`, p);
  // Client 23-10-2026: Balance column = the facility header's Amount Outstanding.
  const disp = await displayOutstandingMap(rows.map((r) => r.loan_id)).catch(() => new Map());
  rows.forEach((r) => { if (disp.has(r.loan_id)) r.outstanding_balance = disp.get(r.loan_id); });
  return { rows, meta: pageMeta(page, per, cnt[0] ? cnt[0].total : 0) };
}

/**
 * Drawdown facility model (client 09-10-2026).
 * Agreed drawdowns come from applications.agreed_terms.drawdowns [{month, gross, net}].
 * Each tranche accrues retained interest for its remaining months (term - month) at the
 * monthly rate; a released loan_drawdowns row (matched by agreed_month) marks it sent.
 * Exit fee = one month's interest on the total gross drawn (base + sent tranches), so it
 * grows as tranches go out (client: "exit fee changes depending on what is drawndown").
 */
function drawdownModel(facility, drawdownRows, paidTotal = 0) {
  let terms = {};
  try { terms = facility.agreed_terms ? JSON.parse(facility.agreed_terms) : {}; } catch (_) { terms = {}; }
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const ratePct = Number(terms.monthly_rate_pct != null ? terms.monthly_rate_pct : (facility.rate_pct || 0));
  const term = Number(facility.term_months || 0);
  const isRetained = String(terms.interest_type || '').toLowerCase() === 'retained';
  const agreed = Array.isArray(terms.drawdowns) ? terms.drawdowns : [];
  const sentByMonth = new Map();
  (drawdownRows || []).forEach((d) => {
    if (String(d.status) === 'Scheduled') return; // agreed but not yet sent
    const m = d.agreed_month != null ? Number(d.agreed_month) : null;
    if (m != null) sentByMonth.set(m, d);
  });
  const plan = agreed.map((d, i) => {
    const month = d.month != null ? Number(d.month) : null;
    const gross = r2(d.gross != null ? d.gross : d.amount);
    const monthsLeft = (term && month != null) ? Math.max(0, term - month) : 0;
    const interest = isRetained ? r2(gross * (ratePct / 100) * monthsLeft) : 0;
    const net = d.net != null ? r2(d.net) : r2(gross - interest);
    const sent = month != null ? sentByMonth.get(month) : null;
    return {
      index: i + 1, month, months_left: monthsLeft, gross, net, interest,
      sent: !!sent, drawdown_id: sent ? sent.drawdown_id : null,
      drawn_on: sent ? sent.drawn_on : null, document_id: sent ? sent.document_id : null,
      notes: sent ? sent.notes : null,
    };
  });
  const baseGross = r2(facility.principal);
  const baseNet = r2(facility.net_advance != null ? facility.net_advance : facility.principal);
  const sentPlan = plan.filter((d) => d.sent);
  const ddGross = r2(sentPlan.reduce((sum, d) => sum + d.gross, 0));
  const ddNet = r2(sentPlan.reduce((sum, d) => sum + d.net, 0));
  const ddInterest = r2(sentPlan.reduce((sum, d) => sum + d.interest, 0));
  // Client 12-10-2026: the header shows the TOTAL agreed drawdowns from the indicative
  // (every planned tranche), not only the sent ones.
  const agreedGross = r2(plan.reduce((sum, d) => sum + d.gross, 0));
  const agreedNet = r2(plan.reduce((sum, d) => sum + d.net, 0));
  const agreedInterest = r2(plan.reduce((sum, d) => sum + d.interest, 0));
  // Client 13-10-2026: base retained interest is on the DAY-1 gross (total gross less the agreed
  // drawdowns); each drawdown carries its own retained interest. Total interest then matches the
  // offer's "Retained Interest Total".
  const day1Gross = r2(baseGross - agreedGross);
  const baseInterest = isRetained ? r2(day1Gross * (ratePct / 100) * term) : 0;
  const totalGross = r2(baseGross + ddGross);
  const exitFee = r2(totalGross * (ratePct / 100));
  // Client 12-10-2026: recorded payments reduce the outstanding shown in the header.
  const paid = Number(paidTotal) || 0;
  return {
    is_drawdown_facility: agreed.length > 0,
    interest_type: terms.interest_type || null,
    monthly_rate_pct: ratePct,
    plan,
    base: { net: baseNet, gross: baseGross, interest: baseInterest },
    drawdowns: { net: ddNet, gross: ddGross, interest: ddInterest },
    drawdowns_agreed: { net: agreedNet, gross: agreedGross, interest: agreedInterest },
    totals: { net: r2(baseNet + ddNet), gross: totalGross, interest: r2(baseInterest + agreedInterest) },
    exit_fee: exitFee,
    // Client 13-10-2026: outstanding = gross drawn less payments (exit fee is NOT part of the
    // running balance; adding it made outstanding exceed the gross loan).
    amount_outstanding: r2(Math.max(0, totalGross - paid)),
  };
}

/**
 * Client 22-10-2026: keep loans.outstanding_balance = net loan (day 1 + released drawdowns)
 * less payments recorded. Only ever moved by drawdowns and MANUAL transactions - never by
 * a redemption quote or Redeem Facility. Returns the position.
 */
async function syncOutstanding(loanKey) {
  const R = redemptionSvc();
  const loan = await R.loadLoan(loanKey);
  if (!loan) return null;
  const { drawdowns, payments } = await R.ledger(loan.loan_id);
  const pos = fp.position(loan, drawdowns, payments);
  const grossOut = grossOutstanding(pos);
  if (loan.status === 'Active' && Math.abs(Number(loan.outstanding_balance ?? -1) - grossOut) > 0.005) {
    await db.query('UPDATE loans SET outstanding_balance = @p1, updated_at = SYSUTCDATETIME() WHERE loan_id = @p0', [loan.loan_id, grossOut]);
  }
  await syncSchedule(loan.loan_id, pos.paid);
  return { loan, pos };
}

/**
 * Client 27-10-2026: mark instalments Paid as payments come in (they stayed 'Due' forever, so
 * the Today tab showed Payment on every facility). The payments recorded so far are applied
 * to the instalments in order: an instalment is Paid once the running total due up to it is
 * covered, else Due. Recomputed from scratch each time, so it is always in step.
 */
async function syncSchedule(loanId, paid) {
  await db.query(
    `WITH s AS (
       SELECT status, SUM(total_due) OVER (ORDER BY installment_no ROWS UNBOUNDED PRECEDING) AS cum
         FROM loan_schedules WHERE loan_id = @p0 AND flag_deleted = 0 AND status IN ('Due', 'Paid'))
     UPDATE s SET status = CASE WHEN cum <= @p1 + 0.005 THEN 'Paid' ELSE 'Due' END
      WHERE status <> CASE WHEN cum <= @p1 + 0.005 THEN 'Paid' ELSE 'Due' END`,
    [loanId, Number(paid) || 0],
  );
}

/**
 * Client 23-10-2026: the Amount Outstanding the facility header shows, for many loans at
 * once (listing balance + KPI tiles must match the header):
 *   - redeemed / closed                        -> 0
 *   - Redeem Facility done (Completed quote)   -> fixed redemption amount - payments
 *   - otherwise                                -> GROSS loan (incl. agreed drawdowns) - payments
 * Returns Map(loan_id -> amount).
 */
async function displayOutstandingMap(loanIds) {
  const ids = [...new Set((loanIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const list = ids.join(',');  // integers only (Number + filter above) - safe to inline
  const [loans, dds, pays, reds] = await Promise.all([
    db.query(`SELECT l.loan_id, l.status, l.principal, l.rate_pct, l.outstanding_balance,
                     CONVERT(varchar(10), l.start_date, 23) AS start_date, CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
                     a.net_advance, a.agreed_terms
                FROM loans l JOIN applications a ON a.application_id = l.application_id
               WHERE l.loan_id IN (${list})`),
    db.query(`SELECT loan_id, CONVERT(varchar(10), drawn_on, 23) AS drawn_on, amount, status, agreed_month
                FROM loan_drawdowns WHERE flag_deleted = 0 AND loan_id IN (${list})`).catch(() => []),
    db.query(`SELECT loan_id, CONVERT(varchar(10), paid_on, 23) AS paid_on, amount
                FROM loan_payments WHERE flag_deleted = 0 AND loan_id IN (${list})`).catch(() => []),
    db.query(`SELECT r.loan_id, r.total_amount, r.figures_json FROM loan_redemptions r
               WHERE r.flag_deleted = 0 AND r.status = 'Completed' AND r.loan_id IN (${list})
                 AND r.redemption_id = (SELECT TOP 1 r2.redemption_id FROM loan_redemptions r2
                                         WHERE r2.loan_id = r.loan_id AND r2.flag_deleted = 0 AND r2.status = 'Completed'
                                         ORDER BY r2.completed_at DESC, r2.redemption_id DESC)`).catch(() => []),
  ]);
  const by = (rows) => { const m = new Map(); rows.forEach((x) => { if (!m.has(x.loan_id)) m.set(x.loan_id, []); m.get(x.loan_id).push(x); }); return m; };
  const ddBy = by(dds); const payBy = by(pays);
  const redBy = new Map(reds.map((x) => [x.loan_id, x]));
  const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
  for (const l of loans) {
    if (['Redeemed', 'Recovered', 'Written Off'].includes(String(l.status))) { out.set(l.loan_id, 0); continue; }
    const pos = fp.position(l, ddBy.get(l.loan_id) || [], payBy.get(l.loan_id) || []);
    const red = redBy.get(l.loan_id);
    if (red && l.status === 'Active') {
      let fx = null;
      try { fx = red.figures_json ? JSON.parse(red.figures_json) : null; } catch (_) { fx = null; }
      const required = fx ? Number(fx.total_amount || 0) + Number(fx.amount_paid || 0) : Number(red.total_amount || 0);
      out.set(l.loan_id, Math.max(0, r2(required - pos.paid)));
    } else {
      out.set(l.loan_id, grossOutstanding(pos));
    }
  }
  return out;
}

/** Portfolio KPI summary (whole book) — value, active count, arrears and 30/60/90 maturity buckets. */
async function portfolioSummary({ scopeUserId = null } = {}) {
  const sp = {};
  const scope = scopeAnd(scopeUserId, sp);
  const rows = await db.queryNamed(
    `SELECT
        COUNT(*) AS active_count,
        SUM(COALESCE(l.outstanding_balance, l.principal, 0)) AS portfolio_value,
        SUM(COALESCE(ar.arrears_amount, 0)) AS arrears_amount,
        SUM(CASE WHEN cnt.n IS NULL OR cnt.n = 0 THEN 0 ELSE 1 END) AS arrears_count,
        SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, 30, CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS b30_count,
        SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, 30, CAST(GETUTCDATE() AS date)) THEN COALESCE(l.outstanding_balance, l.principal, 0) ELSE 0 END) AS b30_value,
        SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, 60, CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS b60_count,
        SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, 60, CAST(GETUTCDATE() AS date)) THEN COALESCE(l.outstanding_balance, l.principal, 0) ELSE 0 END) AS b60_value,
        SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, 90, CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS b90_count,
        SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day, 90, CAST(GETUTCDATE() AS date)) THEN COALESCE(l.outstanding_balance, l.principal, 0) ELSE 0 END) AS b90_value
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       LEFT JOIN (SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount, COUNT(*) AS n FROM collections WHERE flag_deleted = 0 AND status <> 'Closed' GROUP BY loan_id) ar ON ar.loan_id = l.loan_id
       OUTER APPLY (SELECT ar.n) cnt
      WHERE l.flag_deleted = 0 AND l.status = 'Active'${scope}`,
    sp,
  );
  const r = rows[0] || {};
  // Client 23-10-2026: book value + maturity buckets from the same Amount Outstanding the
  // facility header / listing show (incl. agreed drawdowns, fixed redemption amounts).
  try {
    const sp3 = {};
    const scope3 = scopeAnd(scopeUserId, sp3);
    const act = await db.queryNamed(
      `SELECT l.loan_id, DATEDIFF(day, CAST(GETUTCDATE() AS date), l.maturity_date) AS days_left
         FROM loans l
         JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
         JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
        WHERE l.flag_deleted = 0 AND l.status = 'Active'${scope3}`, sp3);
    const disp = await displayOutstandingMap(act.map((x) => x.loan_id));
    const val = (x) => Number(disp.get(x.loan_id) || 0);
    r.portfolio_value = act.reduce((t, x) => t + val(x), 0);
    [30, 60, 90].forEach((d) => {
      const inB = act.filter((x) => x.days_left != null && x.days_left >= 0 && x.days_left <= d);
      r[`b${d}_count`] = inB.length;
      r[`b${d}_value`] = inB.reduce((t, x) => t + val(x), 0);
    });
  } catch (e) { console.warn('[portfolio] summary outstanding fallback:', e.message); } // eslint-disable-line no-console
  // Facilities currently in an (open) extension — client 09-10-2026 dashboard box.
  let extensions_count = 0;
  try {
    const sp2 = {};
    const scope2 = scopeAnd(scopeUserId, sp2);
    const ex = await db.queryNamed(
      `SELECT COUNT(DISTINCT x.loan_id) AS n
         FROM portfolio_extensions x
         JOIN loans l ON l.loan_id = x.loan_id AND l.flag_deleted = 0 AND l.status = 'Active'
         JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
         JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
        WHERE x.flag_deleted = 0 AND x.status IN ('Draft','Agreement Sent','Agreement Signed','Pending Approval')${scope2}`,
      sp2);
    extensions_count = Number(ex[0] && ex[0].n ? ex[0].n : 0);
  } catch (_) { extensions_count = 0; }
  return {
    portfolio_value: Number(r.portfolio_value || 0),
    active_count: Number(r.active_count || 0),
    extensions_count,
    arrears_amount: Number(r.arrears_amount || 0),
    arrears_count: Number(r.arrears_count || 0),
    buckets: [
      { days: 30, count: Number(r.b30_count || 0), value: Number(r.b30_value || 0) },
      { days: 60, count: Number(r.b60_count || 0), value: Number(r.b60_value || 0) },
      { days: 90, count: Number(r.b90_count || 0), value: Number(r.b90_value || 0) },
    ],
  };
}

/** Server-paged, server-filtered portfolio customers. */
async function customersPaged(q = {}, { scopeUserId = null } = {}) {
  const { page, per, off, lim } = pageParams(q);
  const p = { off, lim };
  let where = "l.flag_deleted = 0 AND l.status = 'Active'";
  where += scopeAnd(scopeUserId, p);
  const search = str(q.search, 120);
  if (search) {
    where += ` AND (${customerNameSql('ap')} LIKE '%' + @search + '%' OR ap.company_name LIKE '%' + @search + '%')`;
    p.search = search;
  }
  const CORE = `FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       LEFT JOIN applicant_types at ON at.applicant_type_id = ap.applicant_type_id
       LEFT JOIN branches b ON b.branch_id = a.branch_id
       LEFT JOIN (SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount FROM collections WHERE flag_deleted = 0 AND status <> 'Closed' GROUP BY loan_id) ar ON ar.loan_id = l.loan_id
      WHERE ${where}
      GROUP BY aa.applicant_id, ${customerNameSql('ap')}`;
  const rows = await db.queryNamed(
    `SELECT aa.applicant_id, ${customerNameSql('ap')} AS customer_name,
            MAX(at.name) AS applicant_type, MAX(ap.company_name) AS company_name, MAX(b.branch_name) AS branch_name,
            COUNT(DISTINCT l.loan_id) AS facilities, COUNT(DISTINCT a.application_id) AS applications,
            SUM(COALESCE(l.outstanding_balance, l.principal, 0)) AS exposure,
            SUM(COALESCE(ar.arrears_amount, 0)) AS arrears_amount,
            CONVERT(varchar(10), MIN(ap.created_at), 23) AS created_at
       ${CORE}
      ORDER BY ${customerNameSql('ap')}
      OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`, p);
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total FROM (SELECT aa.applicant_id ${CORE}) t`, p);
  return { rows, meta: pageMeta(page, per, cnt[0] ? cnt[0].total : 0) };
}

/** Server-paged, server-filtered portfolio contact logs. */
async function listContactsPaged(q = {}, { scopeUserId = null } = {}) {
  const { page, per, off, lim } = pageParams(q);
  const p = {
    off, lim,
    search: str(q.search, 100), method: str(q.method, 30),
    outcome: str(q.outcome, 50), status: str(q.status, 30),
  };
  const WHERE = `FROM portfolio_contact_logs pcl
       JOIN loans l ON l.loan_id = pcl.loan_id
       JOIN applications a ON a.application_id = pcl.application_id
       JOIN applicants ap ON ap.applicant_id = pcl.applicant_id
      WHERE pcl.flag_deleted = 0${scopeAnd(scopeUserId, p)}
        AND (@method IS NULL OR pcl.method = @method)
        AND (@outcome IS NULL OR pcl.contact_outcome = @outcome)
        AND (@status IS NULL OR pcl.followup_status = @status)
        AND (@search IS NULL OR ${customerNameSql('ap')} LIKE '%' + @search + '%'
          OR l.loan_number LIKE '%' + @search + '%'
          OR a.application_ref LIKE '%' + @search + '%'
          OR pcl.person LIKE '%' + @search + '%'
          OR pcl.contact_notes LIKE '%' + @search + '%')`;
  const rows = await db.queryNamed(
    `SELECT pcl.log_id, pcl.loan_id, l.loan_number, pcl.application_id, a.application_ref,
            pcl.applicant_id, ${customerNameSql('ap')} AS customer_name,
            CONVERT(varchar(10), pcl.contact_date, 23) AS contact_date,
            pcl.person, pcl.method, pcl.contact_notes,
            CONVERT(varchar(10), pcl.followup_date, 23) AS followup_date,
            pcl.outlook_reminder, pcl.outlook_event_id, pcl.followup_status, pcl.contact_outcome,
            pcl.created_at, pcl.updated_at
       ${WHERE}
      ORDER BY pcl.contact_date DESC, pcl.log_id DESC
      OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`, p);
  const cnt = await db.queryNamed(`SELECT COUNT(*) AS total ${WHERE}`, p);
  return { rows, meta: pageMeta(page, per, cnt[0] ? cnt[0].total : 0) };
}

async function facilityDetail(id) {
  const key = String(id || '').trim();
  const rows = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.application_id, a.application_ref,
            a.enquiry_id, uc.underwriting_case_id,
            aa.applicant_id, ${customerNameSql('ap')} AS customer_name,
            ap.email AS customer_email, ap.phone AS customer_phone,
            p.name AS product, b.branch_name, l.principal, l.rate_pct,
            l.term_months, l.outstanding_balance, a.net_advance, a.rolled_interest, a.agreed_terms, a.exit_fee AS app_exit_fee,
            CONVERT(varchar(10), l.start_date, 23) AS start_date,
            CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
            l.status, COALESCE(ar.arrears_amount, 0) AS arrears_amount,
            COALESCE(ar.days_overdue, 0) AS days_overdue,
            l.bad_debt_at, bdu.full_name AS bad_debt_by_name,
            l.bad_debt_note, l.bad_debt_note_at, bnu.full_name AS bad_debt_note_by_name,
            l.written_off_at, wou.full_name AS written_off_by_name, l.write_off_amount, l.write_off_reason
       FROM loans l
       LEFT JOIN users bdu ON bdu.user_id = l.bad_debt_by
       LEFT JOIN users bnu ON bnu.user_id = l.bad_debt_note_by
       LEFT JOIN users wou ON wou.user_id = l.written_off_by
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       LEFT JOIN products p ON p.product_id = a.product_id
       LEFT JOIN branches b ON b.branch_id = a.branch_id
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       LEFT JOIN (
         SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount, MAX(COALESCE(days_overdue, 0)) AS days_overdue
           FROM collections
          WHERE flag_deleted = 0 AND status <> 'Closed'
          GROUP BY loan_id
       ) ar ON ar.loan_id = l.loan_id
      WHERE l.flag_deleted = 0
        AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)
      ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id`,
    { key },
  );
  const facility = rows[0];
  if (!facility) return null;

  const [schedule, payments, collections, security, documents, contacts, requests, fees, drawdowns, covenants, redemptions, auditRows, documentTypes, valuationSteps] = await Promise.all([
    db.query('SELECT schedule_id, installment_no, CONVERT(varchar(10), due_date, 23) AS due_date, principal_due, interest_due, total_due, status FROM loan_schedules WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY due_date, installment_no', [facility.loan_id]),
    db.query('SELECT payment_id, CONVERT(varchar(10), paid_on, 23) AS paid_on, amount, method, reference FROM loan_payments WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY paid_on DESC, payment_id DESC', [facility.loan_id]),
    db.query('SELECT collection_id, status, arrears_amount, days_overdue, notes, created_at FROM collections WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY collection_id DESC', [facility.loan_id]),
    db.query(`SELECT s.security_id, s.property_address, s.estimated_value, s.valuation_amount,
                     CONVERT(varchar(10), s.valuation_date, 23) AS valuation_date,
                     s.valuation_status, s.charge_type, s.risk_rating, s.ltv_band, s.legal_check_status,
                     vt.name AS valuation_type_name
                FROM application_security s
                LEFT JOIN valuation_types vt ON vt.valuation_type_id = s.valuation_type_id
               WHERE s.application_id = @p0 AND s.flag_deleted = 0
               ORDER BY s.security_id`, [facility.application_id]),
    db.query(`SELECT d.app_document_id, d.file_name, d.file_path, d.status, d.version, d.verified_status,
                     dt.name AS document_type_name, dt.category AS document_category, d.created_at,
                     COALESCE(up.full_name, 'System') AS uploaded_by_name
                FROM application_documents d
                LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
                LEFT JOIN users up ON up.user_id = d.uploaded_by
               WHERE d.application_id = @p0 AND d.flag_deleted = 0
               ORDER BY d.app_document_id DESC`, [facility.application_id]),
    listContacts({ loan_id: facility.loan_id }),
    facilityRequests(facility.loan_id),
    db.query(
      `SELECT fee_id, fee_type, amount,
              CONVERT(varchar(10), due_date, 23) AS due_date, status, notes, extension_id,
              CONVERT(varchar(10), paid_on, 23) AS paid_on, paid_method, paid_reference
         FROM loan_fees WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY due_date, fee_id`,
      [facility.loan_id],
    ),
    db.query(
      `SELECT drawdown_id, drawdown_no, CONVERT(varchar(10), drawn_on, 23) AS drawn_on,
              amount, notes, status, agreed_month, document_id
         FROM loan_drawdowns WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY drawn_on, drawdown_no`,
      [facility.loan_id],
    ),
    db.query(
      `SELECT covenant_id, name, covenant_type, frequency,
              CONVERT(varchar(10), next_due, 23) AS next_due, status, notes
         FROM loan_covenants WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY next_due, covenant_id`,
      [facility.loan_id],
    ),
    db.query(
      `SELECT r.redemption_id, CONVERT(varchar(10), r.redemption_date, 23) AS redemption_date,
              r.principal_amount, r.accrued_interest, r.exit_fee, r.other_fees, r.credits, r.total_amount,
              r.status, r.document_id, r.payment_id, r.created_at, r.completed_at,
              r.interest_basis, r.days_elapsed, r.months_charged, r.min_interest_months, r.min_interest_adj,
              r.emailed_to, r.emailed_cc, r.emailed_at, r.email_status, r.email_error,
              -- Redemption Details tab (client 26-10-2026): who closed it + the full fee breakdown.
              cu.full_name AS completed_by_name, r.figures_json
         FROM loan_redemptions r
         LEFT JOIN users cu ON cu.user_id = r.completed_by
        WHERE r.loan_id=@p0 AND r.flag_deleted=0 ORDER BY r.redemption_id DESC`,
      [facility.loan_id],
    ),
    db.query(
      `SELECT al.audit_id, CONVERT(varchar(10), al.created_at, 23) AS audit_date,
              CONVERT(varchar(8), al.created_at, 108) AS audit_time,
              COALESCE(u.full_name, 'System') AS user_name, r.role_name,
              al.action, al.entity_name, al.entity_id, al.details
         FROM audit_logs al
         LEFT JOIN users u ON u.user_id = al.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE (al.entity_name = 'loans' AND al.entity_id = CONVERT(varchar(60), @p0))
           OR (al.entity_name = 'applications' AND al.entity_id = CONVERT(varchar(60), @p1))
           OR (al.entity_name = 'portfolio_contact_logs' AND al.details LIKE '%' + CONVERT(varchar(20), @p0) + '%')
           OR (al.entity_name = 'portfolio_facility_requests' AND al.details LIKE '%' + CONVERT(varchar(20), @p0) + '%')
        ORDER BY al.created_at DESC, al.audit_id DESC`,
      [facility.loan_id, facility.application_id],
    ),
    db.query(`SELECT document_type_id AS id, name, category FROM document_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    // Valuation figures live on underwriting Step 2 (the Valuations-team workflow),
    // not on application_security. Pull them so the portfolio Valuation tab shows the
    // real, agreed valuation for the facility. Read-only.
    db.query(
      `SELECT s.underwriting_step_id, s.data,
              CONVERT(varchar(10), s.updated_at, 23) AS updated_at
         FROM underwriting_steps s
         JOIN underwriting_cases c ON c.underwriting_case_id = s.underwriting_case_id AND c.flag_deleted = 0
        WHERE c.application_id = @p0 AND s.step_no = 2 AND ISJSON(s.data) = 1
        ORDER BY s.updated_at DESC`,
      [facility.application_id],
    ),
  ]);

  // Normalise the Step-2 valuation JSON into rows for the Valuation tab.
  const primaryAddress = (security[0] && security[0].property_address) || null;
  const valuations = (valuationSteps || []).map((row) => {
    let f = {};
    try { f = (JSON.parse(row.data || '{}').fields) || {}; } catch (e) { f = {}; }
    const num = (v) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
    const truthy = (v) => v === true || v === 'true';
    let status = null;
    if (f.valuation_result === 'accepted') status = 'Accepted';
    else if (f.valuation_result === 'rejected') status = 'Rejected';
    else if (truthy(f.report_received) || f.market_value != null) status = 'Report Received';
    else if (truthy(f.valuation_sent)) status = 'Instructed';
    return {
      valuation_id: row.underwriting_step_id,
      property_address: f.property_address || primaryAddress,
      valuer_firm: f.valuer_firm || null,
      valuation_type_name: f.valuation_type || null,
      instruction_date: f.instruction_date || null,
      valuation_date: (f.market_value != null ? row.updated_at : null),
      market_value: num(f.market_value),
      gdv_value: num(f.gdv_value),
      condition_rating: f.condition_rating || null,
      recommendation: f.valuation_recommendation || null,
      valuation_status: status,
    };
  }).filter((v) => v.market_value != null || v.gdv_value != null || v.valuation_status || v.valuer_firm || v.valuation_type_name);

  // Client 30-09-2026: Extension tab + Bad Debt tab.
  const [extensions, recoveries] = await Promise.all([
    extensionSvc.forLoan(facility.loan_id).catch(() => []),
    loanRecoveries(facility.loan_id),
  ]);
  const recovered = recoveries.reduce((s, r) => s + Number(r.amount || 0), 0);
  facility.recovered_amount = Math.round(recovered * 100) / 100;
  facility.remaining_balance = Math.max(0, Math.round((Number(facility.outstanding_balance ?? facility.principal ?? 0) - recovered) * 100) / 100);

  const paidTotal = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const drawdowns_summary = drawdownModel(facility, drawdowns, paidTotal);
  // Client 22-10-2026: one position for the header, drawdown summary and redemption.
  const pos = fp.position(facility, drawdowns, payments);
  drawdowns_summary.net_loan = pos.netLoan;
  drawdowns_summary.amount_outstanding = pos.outstanding;
  facility.position = {
    day1_net: pos.day1Net, drawdown_net: pos.drawdownNet, drawdown_gross: pos.drawdownGross,
    drawdowns_released: pos.tranches.length, net_loan: pos.netLoan, gross_drawn: pos.grossDrawn,
    amount_paid: pos.paid, outstanding: pos.outstanding, monthly_interest: pos.monthlyInterest,
    // Client 23-10-2026: header Net Loan = day 1 net + ALL agreed drawdowns net (e.g. 340k + 60k = 400k),
    // like Gross Loan / Interest which already include the drawdowns.
    net_loan_total: Math.round((pos.day1Net + Math.max(pos.agreedNet, pos.drawdownNet)) * 100) / 100,
    redemption_due: null,
    gross_outstanding: grossOutstanding(pos),
  };
  // Client 23-10-2026: once Redeem Facility has fixed the redemption (maturity moved to the
  // redemption date) the Amount Outstanding is what is left of that redemption amount
  // (principal + interest + fees - payments), the same figure Record Payment caps at.
  if (facility.status === 'Active') {
    const fx = await fixedRedemption(facility.loan_id).catch(() => null);
    if (fx) facility.position.redemption_due = Math.max(0, Math.round((fx.required - pos.paid) * 100) / 100);
  }
  const grossOut = grossOutstanding(pos);
  if (facility.status === 'Active' && Math.abs(Number(facility.outstanding_balance ?? -1) - grossOut) > 0.005) {
    await db.query('UPDATE loans SET outstanding_balance = @p1, updated_at = SYSUTCDATETIME() WHERE loan_id = @p0', [facility.loan_id, grossOut])
      .catch((e) => console.warn('[portfolio] outstanding sync failed:', e.message)); // eslint-disable-line no-console
    facility.outstanding_balance = grossOut;
  }
  delete facility.agreed_terms; // raw JSON not needed client-side
  return { facility, schedule, payments, collections, security, documents, contacts, requests, audit: auditRows, fees, drawdowns, drawdowns_summary, covenants, redemptions, valuations, documentTypes, extensions, recoveries };
}

// ---------------------------------------------------------------- bad loans (client 30-09-2026)
async function loanRecoveries(loanId) {
  try {
    return await db.query(
      `SELECT r.recovery_id, CONVERT(varchar(10), r.received_on, 23) AS received_on, r.amount, r.method, r.reference, r.notes,
              r.created_at, COALESCE(u.full_name, 'System') AS created_by_name
         FROM loan_recoveries r LEFT JOIN users u ON u.user_id = r.created_by
        WHERE r.loan_id = @p0 AND r.flag_deleted = 0
        ORDER BY r.received_on, r.recovery_id`, [loanId]);
  } catch (_) { return []; } // table not migrated yet
}

async function loanForBadDebt(loanKey) {
  const key = String(loanKey || '').trim();
  const rows = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.status, l.application_id, l.principal, l.outstanding_balance
       FROM loans l
      WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)`, { key });
  const loan = rows[0];
  if (!loan) return null;
  const rec = await loanRecoveries(loan.loan_id);
  loan.recovered = rec.reduce((s, r) => s + Number(r.amount || 0), 0);
  loan.remaining = Math.max(0, Math.round((Number(loan.outstanding_balance ?? loan.principal ?? 0) - loan.recovered) * 100) / 100);
  return loan;
}

async function badDebtAudit(req, action, loan, details) {
  await audit.write(audit.fromReq(req, {
    action, moduleKey: 'PORTFOLIO.FACILITY_BAD_DEBT', entityName: 'loans', entityId: String(loan.loan_id), details,
  }));
}

/** Active -> Bad Debt, with the (single, timestamped) bad-debt note. */
async function markBadDebt(loanKey, body, req) {
  const loan = await loanForBadDebt(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { status: `Only an active facility can be marked as bad debt (this one is ${loan.status})` } };
  const note = str(body.note, 8000);
  if (!note) return { ok: false, errors: { note: 'Add a note on what has happened' } };
  await db.query(
    `UPDATE loans SET status = 'Bad Debt', bad_debt_at = SYSUTCDATETIME(), bad_debt_by = @p1,
            bad_debt_note = @p2, bad_debt_note_at = SYSUTCDATETIME(), bad_debt_note_by = @p1,
            updated_by = @p1, updated_at = SYSUTCDATETIME()
      WHERE loan_id = @p0`, [loan.loan_id, actorId(req), note]);
  await badDebtAudit(req, 'FACILITY_MARKED_BAD_DEBT', loan, { note: note.slice(0, 200) });
  return { ok: true };
}

/** Replace the bad-debt note (one field; its timestamp shows when it was last updated). */
async function updateBadDebtNote(loanKey, body, req) {
  const loan = await loanForBadDebt(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (!['Bad Debt', 'Written Off', 'Recovered'].includes(loan.status)) return { ok: false, errors: { status: 'This facility is not marked as bad debt' } };
  const note = str(body.note, 8000);
  if (!note) return { ok: false, errors: { note: 'Note cannot be empty' } };
  await db.query(
    `UPDATE loans SET bad_debt_note = @p1, bad_debt_note_at = SYSUTCDATETIME(), bad_debt_note_by = @p2,
            updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE loan_id = @p0`, [loan.loan_id, note, actorId(req)]);
  await badDebtAudit(req, 'BAD_DEBT_NOTE_UPDATED', loan, { note: note.slice(0, 200) });
  return { ok: true };
}

/** Money actually received on a bad debt (may come in instalments). Full recovery closes it. */
async function recordRecovery(loanKey, body, req) {
  const loan = await loanForBadDebt(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Bad Debt') return { ok: false, errors: { status: 'Money received can only be recorded on a bad-debt facility' } };
  const errors = {};
  const amount = num(body.amount);
  const on = date(body.received_on);
  if (!amount || amount <= 0) errors.amount = 'Amount must be greater than zero';
  else if (amount > loan.remaining + 0.005) errors.amount = `Amount cannot exceed the remaining balance of ${gbp(loan.remaining)}`;
  if (!on) errors.received_on = 'Date received is required';
  else if (on > new Date().toISOString().slice(0, 10)) errors.received_on = 'Date received cannot be in the future';
  if (body.method && !PAYMENT_METHODS.has(body.method)) errors.method = 'Select a valid method';
  if (Object.keys(errors).length) return { ok: false, errors };
  const out = await db.query(
    `INSERT INTO loan_recoveries (loan_id, received_on, amount, method, reference, notes, created_by)
     OUTPUT INSERTED.recovery_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)`,
    [loan.loan_id, on, amount, str(body.method, 30), str(body.reference, 80), str(body.notes, 1000), actorId(req)]);
  const remaining = Math.max(0, Math.round((loan.remaining - amount) * 100) / 100);
  let closed = false;
  if (remaining <= 0.005) {
    await db.query(
      `UPDATE loans SET status = 'Recovered', outstanding_balance = 0, updated_by = @p1, updated_at = SYSUTCDATETIME()
        WHERE loan_id = @p0`, [loan.loan_id, actorId(req)]);
    closed = true;
  }
  await badDebtAudit(req, closed ? 'BAD_DEBT_RECOVERED_IN_FULL' : 'BAD_DEBT_MONEY_RECEIVED', loan,
    { recovery_id: out[0].id, amount, received_on: on, remaining });
  return { ok: true, id: out[0].id, remaining, closed };
}

/**
 * Write off (no hope of return): the remaining balance (outstanding less money received) is
 * written off, the facility leaves the book. From Active or Bad Debt.
 */
async function writeOff(loanKey, body, req) {
  const loan = await loanForBadDebt(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (!['Active', 'Bad Debt'].includes(loan.status)) return { ok: false, errors: { status: `A ${loan.status} facility cannot be written off` } };
  const reason = str(body.reason, 8000);
  if (!reason) return { ok: false, errors: { reason: 'Give the reason for writing this facility off' } };
  const firstBad = loan.status === 'Active';
  await db.query(
    `UPDATE loans SET status = 'Written Off', written_off_at = SYSUTCDATETIME(), written_off_by = @p1,
            write_off_amount = @p2, write_off_reason = @p3, outstanding_balance = 0,
            bad_debt_at = COALESCE(bad_debt_at, SYSUTCDATETIME()), bad_debt_by = COALESCE(bad_debt_by, @p1),
            bad_debt_note = COALESCE(bad_debt_note, @p3),
            bad_debt_note_at = CASE WHEN bad_debt_note IS NULL THEN SYSUTCDATETIME() ELSE bad_debt_note_at END,
            bad_debt_note_by = CASE WHEN bad_debt_note IS NULL THEN @p1 ELSE bad_debt_note_by END,
            updated_by = @p1, updated_at = SYSUTCDATETIME()
      WHERE loan_id = @p0`, [loan.loan_id, actorId(req), loan.remaining, reason]);
  await badDebtAudit(req, 'FACILITY_WRITTEN_OFF', loan,
    { write_off_amount: loan.remaining, recovered: loan.recovered, from: firstBad ? 'Active' : 'Bad Debt', reason: reason.slice(0, 200) });
  return { ok: true, write_off_amount: loan.remaining };
}

/** Bad Debt -> Active again (borrower back on track). Note + money received are kept. */
async function restoreBadDebt(loanKey, body, req) {
  const loan = await loanForBadDebt(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Bad Debt') return { ok: false, errors: { status: 'Only a bad-debt facility can be restored to active' } };
  await db.query(
    `UPDATE loans SET status = 'Active', updated_by = @p1, updated_at = SYSUTCDATETIME() WHERE loan_id = @p0`,
    [loan.loan_id, actorId(req)]);
  await badDebtAudit(req, 'BAD_DEBT_RESTORED_TO_ACTIVE', loan, { reason: str(body.reason, 200) || undefined });
  return { ok: true };
}

async function facilityRequests(loanId) {
  return db.query(
    `SELECT request_id, loan_id, request_type, CONVERT(varchar(10), effective_date, 23) AS effective_date,
            CONVERT(varchar(10), current_maturity, 23) AS current_maturity,
            CONVERT(varchar(10), proposed_maturity, 23) AS proposed_maturity,
            new_amount, revised_rate_pct, reason, status, created_at, updated_at
       FROM portfolio_facility_requests
      WHERE loan_id = @p0 AND flag_deleted = 0
      ORDER BY request_id DESC`,
    [loanId],
  );
}

function validateFacilityRequest(body) {
  const errors = {};
  const type = str(body.request_type, 30);
  if (!REQUEST_TYPES.has(type)) errors.request_type = 'Request type must be Extension or Further Advance';
  if (!date(body.effective_date)) errors.effective_date = 'Effective date is required';
  if (type === 'Extension' && !date(body.proposed_maturity)) errors.proposed_maturity = 'Proposed new maturity is required';
  if (type === 'Further Advance' && !num(body.new_amount)) errors.new_amount = 'New amount is required';
  return Object.keys(errors).length ? errors : null;
}

async function createFacilityRequest(loanId, body, req) {
  // Client 30-09-2026: an Extension is now its own Portfolio workflow (Extensions menu) and
  // never raises an enquiry / goes back to underwriting. Old callers are routed there.
  if (str(body && body.request_type, 30) === 'Extension') {
    const out = await extensionSvc.create(loanId, {
      extension_months: body.extension_months,
      exit_plan: body.exit_plan,
      reason: body.reason,
    }, req);
    if (!out.ok) return out;
    return { ok: true, id: out.id, extension_id: out.id, extension_ref: out.ref };
  }
  // Resolve the facility by its key (loan_number OR numeric loan_id) FIRST.
  // Passing Number('FAC-000458') = NaN made liveLoanContext drop the loan filter
  // and return the first active facility in the system, so the request (and the
  // enquiry raised from it) attached to the WRONG customer.
  const loan = await activeLoan(loanId);
  if (!loan) return { ok: false, errors: { loan_id: 'Select a valid active facility' } };
  const ctx = await liveLoanContext({ loanId: loan.loan_id, applicationId: null, applicantId: null });
  if (!ctx) return { ok: false, errors: { loan_id: 'Select a valid active facility' } };
  const errors = validateFacilityRequest(body || {});
  if (errors) return { ok: false, errors };

  const out = await db.query(
    `INSERT INTO portfolio_facility_requests
       (loan_id, request_type, effective_date, current_maturity, proposed_maturity, new_amount, revised_rate_pct, reason, created_by)
     OUTPUT INSERTED.request_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`,
    [
      ctx.loan_id, str(body.request_type, 30), date(body.effective_date), date(body.current_maturity),
      // Revised Rate removed from the request form (client 30-09-2026) - column kept, no longer written.
      date(body.proposed_maturity), num(body.new_amount), null, str(body.reason, 4000), actorId(req),
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_FACILITY_REQUEST_SUBMIT', moduleKey: MODULE_KEY,
    entityName: 'portfolio_facility_requests', entityId: out[0].id,
    details: { loan_id: ctx.loan_id, request_type: str(body.request_type, 30) },
  }));

  // Also raise an Enquiry entry for this extension / further-advance request,
  // built ONLY from the facility's own customer + loan data (no mock data). Both
  // records are kept: the portfolio facility request (Amendments tab) AND the
  // Enquiry (Enquiries module). A failure here never rolls back the request.
  let enquiryId = null;
  let enquiryRef = null;
  let enquiryError = null;
  try {
    const info = (await db.query(
      `SELECT TOP 1 a.application_id, a.branch_id, a.product_id,
              COALESCE(a.loan_purpose_id, oe.loan_purpose_id) AS loan_purpose_id,
              ap.applicant_type_id, ap.first_name, ap.last_name, ap.company_name, ap.company_reg_no,
              ap.email, ap.phone, CONVERT(varchar(10), ap.dob, 23) AS dob,
              l.loan_number, l.principal, l.outstanding_balance, l.term_months,
              CONVERT(varchar(10), l.start_date, 23) AS start_date,
              COALESCE(sec.property_address, oe.property_address) AS property_address,
              COALESCE(sec.estimated_value, oe.estimated_value) AS estimated_value
         FROM loans l
         JOIN applications a ON a.application_id = l.application_id
         JOIN application_applicants aa ON aa.application_id = a.application_id
         JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
         LEFT JOIN enquiries oe ON oe.enquiry_id = a.enquiry_id
         OUTER APPLY (SELECT TOP 1 property_address, estimated_value
                        FROM application_security s
                       WHERE s.application_id = a.application_id AND s.flag_deleted = 0
                       ORDER BY s.security_id) sec
        WHERE l.loan_id = @p0
        ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id`,
      [ctx.loan_id],
    ))[0];

    if (!info) {
      enquiryError = 'Facility customer details not found; enquiry not raised.';
    } else {
      const isCompany = !!String(info.company_name || '').trim();
      const fullName = isCompany
        ? String(info.company_name).trim()
        : [info.first_name, info.last_name].filter(Boolean).join(' ').trim();
      const monthsBetween = (from, to) => {
        if (!from || !to) return null;
        const f = new Date(from + 'T00:00:00');
        const t = new Date(to + 'T00:00:00');
        if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return null;
        return Math.max(1, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()));
      };
      const newAmt = num(body.new_amount);
      const amount = newAmt && newAmt > 0
        ? newAmt
        : (info.outstanding_balance != null ? Number(info.outstanding_balance) : Number(info.principal || 0));
      const term = monthsBetween(date(body.effective_date) || info.start_date, date(body.proposed_maturity))
        || (info.term_months ? Number(info.term_months) : 12);

      const enqBody = {
        applicant_type_id: info.applicant_type_id || undefined,
        applicant_name: fullName || undefined,
        company_name: isCompany ? String(info.company_name).trim() : undefined,
        company_reg_no: info.company_reg_no || undefined,
        email: info.email || undefined,
        phone: info.phone || undefined,
        dob: info.dob || undefined,
        branch_id: info.branch_id || undefined,
        product_id: info.product_id || undefined,
        loan_purpose_id: info.loan_purpose_id || undefined,
        amount_requested: amount,
        term_months: term,
        property_address: info.property_address || `Security held for facility ${info.loan_number}`,
        estimated_value: info.estimated_value != null ? Number(info.estimated_value) : undefined,
        summary:
          `${str(body.request_type, 30)} Request raised from facility ${info.loan_number}. ` +
          (body.proposed_maturity ? `Proposed maturity: ${date(body.proposed_maturity)}. ` : '') +
          (body.reason ? `Reason: ${str(body.reason, 3500)}` : ''),
        applicants: [{
          full_name: fullName,
          is_primary: true,
          email: info.email || undefined,
          mobile: info.phone || undefined,
          dob: info.dob || undefined,
        }],
      };
      const created = await enquiry.create(enqBody, req, { source: 'manual' });
      if (created && created.ok) {
        enquiryId = created.id;
        enquiryRef = created.ref;
      } else {
        const errEntries = created && created.errors ? Object.entries(created.errors) : [];
        enquiryError = errEntries.length
          ? errEntries.map(([k, v]) => `${k}: ${v}`).slice(0, 3).join('; ')
          : 'Enquiry could not be raised from this facility.';
      }
    }
  } catch (e) {
    enquiryError = (e && e.message) ? e.message : 'Enquiry could not be raised.';
  }

  return { ok: true, id: out[0].id, enquiry_id: enquiryId, enquiry_ref: enquiryRef, enquiry_error: enquiryError };
}

/** Today as YYYY-MM-DD in UK time (the users' clock), not UTC. */
function ukToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function validatePayment(body) {
  const errors = {};
  const amount = num(body.amount);
  if (!amount || amount <= 0) errors.amount = 'Amount must be greater than zero';
  if (!date(body.paid_on)) errors.paid_on = 'Payment date is required';
  else if (String(body.paid_on).slice(0, 10) > ukToday()) {
    errors.paid_on = 'Payment date cannot be in the future';
  } else if (String(body.paid_on).slice(0, 10) < ukToday()) {
    // Tester 20-10-2026: a past payment date must not be accepted.
    errors.paid_on = 'Payment date cannot be in the past';
  }
  if (!PAYMENT_METHODS.has(body.method)) errors.method = 'Method must be a valid payment method';
  if (body.reference != null && String(body.reference).length > 80) errors.reference = 'Reference is too long';
  return Object.keys(errors).length ? errors : null;
}

async function primaryApplicantId(applicationId) {  const rows = await db.query(
    `SELECT TOP 1 aa.applicant_id FROM application_applicants aa
      WHERE aa.application_id = @p0
      ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id`,
    [applicationId],
  );
  return rows.length ? rows[0].applicant_id : null;
}

async function recordPayment(loanKey, body, req) {
  const key = String(loanKey || '').trim();
  const loans = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.status, l.application_id, l.outstanding_balance, l.principal
       FROM loans l
      WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)`,
    { key },
  );
  const loan = loans[0];
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Payments can only be recorded on active facilities' } };
  const errors = validatePayment(body || {});
  if (errors) return { ok: false, errors };

  // A payment can never exceed what is still owed: the redemption amount on the payment
  // date (outstanding principal + interest + charges), client 22-10-2026.
  const R = redemptionSvc();
  const full = await R.loadLoan(loan.loan_id);
  let due = full ? (await R.figures(full, { redemption_date: date(body.paid_on) })).total_amount : Number(loan.outstanding_balance ?? 0);
  // Redemption date already fixed (Redeem Facility) -> what is left of that fixed amount.
  const fixedRed = await fixedRedemption(loan.loan_id);
  if (fixedRed) {
    const { payments: pays } = await R.ledger(loan.loan_id);
    const paidSoFar = pays.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    due = Math.max(0, Math.round((fixedRed.required - paidSoFar) * 100) / 100);
  } else if (full) {
    // Client 23-10-2026 (option A): the borrower may always pay off the GROSS loan.
    const { drawdowns: dd0, payments: pays0 } = await R.ledger(loan.loan_id);
    due = Math.max(due, grossOutstanding(fp.position(full, dd0, pays0)));
  }
  const payAmount = num(body.amount);
  // Tester 20-10-2026: nothing left to pay -> no payment at all.
  if (due <= 0.005) return { ok: false, errors: { amount: 'This facility has no outstanding balance' } };
  if (payAmount != null && payAmount > due + 0.005) {
    return { ok: false, errors: { amount: `Payment cannot exceed the amount due of ${gbp(due)}` } };
  }

  // Optional pin to a specific installment — must belong to this loan.
  let scheduleId = null;
  if (body.schedule_id != null && body.schedule_id !== '') {
    const s = await db.query(
      'SELECT schedule_id FROM loan_schedules WHERE schedule_id = @p0 AND loan_id = @p1 AND flag_deleted = 0',
      [Number(body.schedule_id), loan.loan_id],
    );
    if (!s.length) return { ok: false, errors: { schedule_id: 'Instalment does not belong to this facility' } };
    scheduleId = s[0].schedule_id;
  }

  // Customer link: resolved from the loan; an explicit applicant must match.
  const resolved = await primaryApplicantId(loan.application_id);
  let applicantId = resolved;
  if (body.applicant_id != null && body.applicant_id !== '') {
    applicantId = Number(body.applicant_id);
    if (resolved && applicantId !== resolved) {
      return { ok: false, errors: { applicant_id: 'Customer does not belong to this facility' } };
    }
  }

  const out = await db.query(
    `INSERT INTO loan_payments (loan_id, schedule_id, applicant_id, paid_on, amount, method, reference, created_by)
      OUTPUT INSERTED.payment_id AS id
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)`,
    [
      loan.loan_id, scheduleId, applicantId, date(body.paid_on), num(body.amount),
      str(body.method, 30), str(body.reference, 80), actorId(req),
    ],
  );
  // Client 22-10-2026: the outstanding moves ONLY here (manual transaction) and from drawdowns.
  await syncOutstanding(loan.loan_id);
  // Facility already redeemed (Redeem Facility) and now fully paid -> close it.
  const settled = await settleIfPaid(loan.loan_id, req);
  await audit.write(audit.fromReq(req, {
    action: 'PAYMENT_RECORDED', moduleKey: MODULE_KEY,
    entityName: 'loans', entityId: String(loan.loan_id),
    details: {
      payment_id: out[0].id, amount: num(body.amount), paid_on: date(body.paid_on),
      method: str(body.method, 30), applicant_id: applicantId, schedule_id: scheduleId,
    },
  }));
  return { ok: true, id: out[0].id, redeemed: !!settled };
}

async function redemptionFigures(loan, redemptionDate) {
  const days = Math.max(0, Math.round((new Date(`${redemptionDate}T00:00:00`).getTime() - new Date(`${date(loan.start_date)}T00:00:00`).getTime()) / 86400000));
  const principal = Number(loan.outstanding_balance ?? loan.principal ?? 0);
  const daily = principal * (Number(loan.rate_pct || 0) / 100) / 365;
  const accrued = daily * days;
  const fees = await db.query(
    `SELECT fee_type, amount, status FROM loan_fees WHERE loan_id=@p0 AND flag_deleted=0 AND status NOT IN ('Waived', 'Capitalised')`,
    [loan.loan_id],
  );
  const exitFee = fees.filter((f) => String(f.fee_type).toLowerCase() === 'exit').reduce((s, f) => s + Number(f.amount || 0), 0);
  const otherFees = fees.filter((f) => String(f.fee_type).toLowerCase() !== 'exit' && String(f.status) !== 'Paid').reduce((s, f) => s + Number(f.amount || 0), 0);
  return {
    principal_amount: principal,
    accrued_interest: accrued,
    exit_fee: exitFee,
    other_fees: otherFees,
    credits: 0,
    total_amount: principal + accrued + exitFee + otherFees,
  };
}

async function createRedemption(loanKey, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Only active facilities can be redeemed' } };
  const redemptionDate = date(body.redemption_date);
  if (!redemptionDate) return { ok: false, errors: { redemption_date: 'Redemption date is required' } };
  const rows = await db.query('SELECT principal, outstanding_balance, rate_pct, start_date FROM loans WHERE loan_id=@p0', [loan.loan_id]);
  const fullLoan = { ...loan, ...rows[0] };
  const figures = await redemptionFigures(fullLoan, redemptionDate);
  const name = `Redemption Statement - ${loan.loan_number} - ${redemptionDate}.pdf`;
  const safe = `${Date.now()}_${name.replace(/[^\w.\-]+/g, '_')}`;
  const rel = path.join('uploads', 'application_documents', safe);
  const abs = path.join(global.basePath || path.join(__dirname, '..'), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, await pdfBuffer([
    ['Facility', loan.loan_number],
    ['Redemption Date', redemptionDate],
    ['Outstanding Principal', gbp(figures.principal_amount)],
    ['Accrued Interest', gbp(figures.accrued_interest)],
    ['Exit Fee', gbp(figures.exit_fee)],
    ['Other Fees', gbp(figures.other_fees)],
    ['Credits', gbp(figures.credits)],
    ['Total Redemption Amount', gbp(figures.total_amount)],
  ]));
  const docType = await db.query("SELECT TOP 1 document_type_id FROM document_types WHERE flag_deleted=0 AND is_active=1 AND (name LIKE '%Statement%' OR category='Legal') ORDER BY CASE WHEN name LIKE '%Statement%' THEN 0 ELSE 1 END, name");
  const doc = await db.query(
    `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
     OUTPUT INSERTED.app_document_id AS id
     VALUES (@p0, @p1, @p2, @p3, 'Generated', 'v1', @p4, @p4)`,
    [loan.application_id, docType[0]?.document_type_id || null, name, rel, actorId(req)],
  );
  const out = await db.query(
    `INSERT INTO loan_redemptions
       (loan_id, application_id, redemption_date, principal_amount, accrued_interest, exit_fee, other_fees, credits, total_amount, document_id, created_by)
     OUTPUT INSERTED.redemption_id AS id
     VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10)`,
    [loan.loan_id, loan.application_id, redemptionDate, figures.principal_amount, figures.accrued_interest, figures.exit_fee, figures.other_fees, figures.credits, figures.total_amount, doc[0].id, actorId(req)],
  );
  await audit.write(audit.fromReq(req, {
    action: 'REDEMPTION_STATEMENT_GENERATED', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loan.loan_id),
    details: { redemption_id: out[0].id, document_id: doc[0].id, total_amount: figures.total_amount },
  }));
  return { ok: true, id: out[0].id, document_id: doc[0].id, ...figures };
}

/**
 * Redeem Facility (client 22-10-2026): fixes the redemption DATE only.
 *  - the facility's maturity moves to the redemption date;
 *  - the statement's figures are recalculated for that date (all charges);
 *  - NOTHING is paid or deducted automatically - the outstanding only falls when the
 *    user records the payment (Record Payment). Once the payments cover the redemption
 *    amount the facility closes as Redeemed (settleIfPaid).
 */
async function completeRedemption(loanKey, redemptionId, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Only active facilities can be redeemed' } };
  const rows = await db.query(
    `SELECT redemption_id, redemption_date, interest_basis, min_interest_months, figures_json FROM loan_redemptions
      WHERE redemption_id=@p0 AND loan_id=@p1 AND flag_deleted=0 AND status='Quoted'`,
    [Number(redemptionId), loan.loan_id],
  ).catch(() => db.query(
    `SELECT redemption_id, redemption_date, interest_basis, min_interest_months FROM loan_redemptions
      WHERE redemption_id=@p0 AND loan_id=@p1 AND flag_deleted=0 AND status='Quoted'`, [Number(redemptionId), loan.loan_id]));
  if (!rows.length) return { ok: false, notFound: true };
  const red = rows[0];
  const R = redemptionSvc();
  const full = await R.loadLoan(loan.loan_id);
  let prev = {};
  try { prev = red.figures_json ? JSON.parse(red.figures_json) : {}; } catch (_) { prev = {}; }
  // Same inputs as the quote (fees / exit fee choices), recalculated for its date.
  const f = await R.figures(full, {
    redemption_date: date(red.redemption_date),
    interest_basis: red.interest_basis || prev.interest_basis,
    min_interest_months: red.min_interest_months != null ? red.min_interest_months : prev.min_interest_months,
    document_fee: prev.document_fee, broker_fee: prev.broker_fee, arrangement_fee: prev.arrangement_fee,
    exit_fee_type: prev.exit_fee_type || undefined, exit_fee_value: prev.exit_fee_value,
    exit_fee: prev.exit_fee_edited ? prev.exit_fee : undefined,
  });
  await db.query(
    `UPDATE loan_redemptions SET status='Completed', completed_by=@p1, completed_at=SYSUTCDATETIME(),
            principal_amount=@p2, accrued_interest=@p3, exit_fee=@p4, other_fees=@p5, total_amount=@p6, min_interest_adj=@p7
      WHERE redemption_id=@p0`,
    [red.redemption_id, actorId(req), f.principal_amount, Math.round((f.accrued_interest + f.min_interest_adj) * 100) / 100,
      f.exit_fee, f.other_fees, f.total_amount, f.min_interest_adj],
  );
  await db.query('UPDATE loan_redemptions SET figures_json=@p1 WHERE redemption_id=@p0', [red.redemption_id, JSON.stringify(f)]).catch(() => null);
  await db.query(
    'UPDATE loans SET maturity_date=@p2, updated_by=@p0, updated_at=SYSUTCDATETIME() WHERE loan_id=@p1',
    [actorId(req), loan.loan_id, f.redemption_date],
  );
  await audit.write(audit.fromReq(req, {
    action: 'FACILITY_REDEMPTION_DATE_SET', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loan.loan_id),
    details: { redemption_id: red.redemption_id, redemption_date: f.redemption_date, total_amount: f.total_amount },
  }));
  const settled = await settleIfPaid(loan.loan_id, req);
  return { ok: true, id: red.redemption_id, redemption_date: f.redemption_date, total_amount: f.total_amount, redeemed: !!settled };
}

/**
 * Redeem Facility from a sent statement (client 26-10-2026): one click closes the facility on
 * that statement's terms - no separate Record Payment.
 *  1. the statement is finalised for its date (same as completeRedemption);
 *  2. whatever is still owed on it is recorded as one payment on the redemption date
 *     (method "Redemption", reference RS-<id>) so the ledger / income reports stay right;
 *  3. the facility closes as Redeemed with a nil outstanding.
 */
async function redeemFromStatement(loanKey, redemptionId, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Only active facilities can be redeemed' } };
  const st = await db.query(
    `SELECT redemption_id, status, redemption_date, total_amount FROM loan_redemptions
      WHERE redemption_id=@p0 AND loan_id=@p1 AND flag_deleted=0`, [Number(redemptionId), loan.loan_id]);
  if (!st.length) return { ok: false, notFound: true };
  // A Quoted statement is finalised first; one already fixed by the old Redeem Facility
  // button (Completed, facility still live) goes straight to payment + close.
  const done = st[0].status === 'Quoted'
    ? await completeRedemption(loanKey, redemptionId, req)
    : { ok: true, id: st[0].redemption_id, redemption_date: date(st[0].redemption_date), total_amount: Number(st[0].total_amount || 0), redeemed: false };
  if (!done.ok) return done;

  let paymentId = null; let paid = 0;
  if (!done.redeemed) {
    const fx = await fixedRedemption(loan.loan_id);
    const { payments } = await redemptionSvc().ledger(loan.loan_id);
    const paidSoFar = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    paid = Math.max(0, Math.round(((fx ? fx.required : 0) - paidSoFar) * 100) / 100);
    if (paid > 0.005) {
      const out = await db.query(
        `INSERT INTO loan_payments (loan_id, schedule_id, applicant_id, paid_on, amount, method, reference, created_by)
          OUTPUT INSERTED.payment_id AS id
          VALUES (@p0, NULL, @p1, @p2, @p3, 'Redemption', @p4, @p5)`,
        [loan.loan_id, await primaryApplicantId(loan.application_id), done.redemption_date, paid, `RS-${done.id}`, actorId(req)],
      );
      paymentId = out[0].id;
      await db.query('UPDATE loan_redemptions SET payment_id=@p1 WHERE redemption_id=@p0', [done.id, paymentId]);
      await syncOutstanding(loan.loan_id);
    }
    // Close it: normally settleIfPaid does; if rounding left a penny, close it anyway.
    if (!(await settleIfPaid(loan.loan_id, req))) {
      await db.query(`UPDATE loans SET status='Redeemed', outstanding_balance=0, updated_at=SYSUTCDATETIME() WHERE loan_id=@p0`, [loan.loan_id]);
    }
  }
  await db.query('UPDATE loans SET outstanding_balance=0 WHERE loan_id=@p0', [loan.loan_id]);
  // "Redeemed by / on" (Redemption Details tab) = this close, also for a statement the old
  // button had already fixed earlier.
  await db.query('UPDATE loan_redemptions SET completed_by=@p1, completed_at=SYSUTCDATETIME() WHERE redemption_id=@p0', [done.id, actorId(req)]);
  await audit.write(audit.fromReq(req, {
    action: 'FACILITY_REDEEMED_FROM_STATEMENT', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loan.loan_id),
    details: { redemption_id: done.id, redemption_date: done.redemption_date, total_amount: done.total_amount, payment_id: paymentId, payment_amount: paid },
  }));
  return { ok: true, id: done.id, redemption_date: done.redemption_date, total_amount: done.total_amount, payment_id: paymentId, payment_amount: paid, redeemed: true };
}

/**
 * The redemption fixed by Redeem Facility (latest Completed statement): everything that has
 * to be received = its total (net of what was paid by then) + what had been paid by then.
 */
async function fixedRedemption(loanId) {
  return redemptionSvc().fixedRedemption(loanId);
}

/** Redeemed facility (a Completed redemption) whose payments now cover it -> status Redeemed. */
async function settleIfPaid(loanId, req) {
  const R = redemptionSvc();
  const full = await R.loadLoan(loanId);
  if (!full || full.status !== 'Active') return false;
  const { drawdowns, payments } = await R.ledger(loanId);
  const pos = fp.position(full, drawdowns, payments);
  const fx = await fixedRedemption(loanId);
  // Client 23-10-2026 (option A): no early redemption -> completed once the GROSS loan is paid.
  const required = fx ? fx.required : pos.grossOwed;
  if (!(required > 0) || pos.paid + 0.005 < required) return false;
  await db.query(
    `UPDATE loans SET status='Redeemed', outstanding_balance=0, updated_at=SYSUTCDATETIME() WHERE loan_id=@p0`, [loanId]);
  await audit.write(audit.fromReq(req, {
    action: 'FACILITY_REDEEMED', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loanId),
    details: { redemption_id: fx ? fx.redemption_id : null, amount_paid: pos.paid, basis: fx ? 'redemption' : 'gross loan paid' },
  }));
  return true;
}

async function activeLoan(loanKey) {
  const key = String(loanKey || '').trim();
  const rows = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.status, l.application_id
       FROM loans l
      WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)`,
    { key },
  );
  return rows[0] || null;
}

async function recordFee(loanKey, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Fees can only be recorded on active facilities' } };
  const errors = {};
  if (!FEE_TYPES.has(body.fee_type)) errors.fee_type = 'Fee type must be a valid fee type';
  const amount = num(body.amount);
  if (!amount || amount <= 0) errors.amount = 'Amount must be greater than zero';
  if (body.due_date != null && body.due_date !== '' && !date(body.due_date)) errors.due_date = 'Due date is invalid';
  if (Object.keys(errors).length) return { ok: false, errors };
  const out = await db.query(
    `INSERT INTO loan_fees (loan_id, fee_type, amount, due_date, status, notes, created_by)
      OUTPUT INSERTED.fee_id AS id
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)`,
    [
      loan.loan_id, str(body.fee_type, 40), amount,
      body.due_date ? date(body.due_date) : null,
      FEE_STATUSES.has(body.status) ? body.status : 'Due',
      str(body.notes, 500), actorId(req),
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'FEE_RECORDED', moduleKey: MODULE_KEY,
    entityName: 'loans', entityId: String(loan.loan_id),
    details: { fee_id: out[0].id, fee_type: str(body.fee_type, 40), amount },
  }));
  return { ok: true, id: out[0].id };
}

async function releaseDrawdown(loanKey, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Drawdowns can only be released on active facilities' } };
  const errors = {};
  const amount = num(body.amount);
  if (!amount || amount <= 0) errors.amount = 'Amount must be greater than zero';
  if (!date(body.drawn_on)) errors.drawn_on = 'Drawdown date is required';
  if (Object.keys(errors).length) return { ok: false, errors };
  const noRow = await db.query(
    'SELECT ISNULL(MAX(drawdown_no), 0) + 1 AS n FROM loan_drawdowns WHERE loan_id = @p0 AND flag_deleted = 0',
    [loan.loan_id],
  );
  const agreedMonth = body.agreed_month != null && body.agreed_month !== '' ? Number(body.agreed_month) : null;
  const documentId = body.document_id != null && body.document_id !== '' ? Number(body.document_id) : null;
  const out = await db.query(
    `INSERT INTO loan_drawdowns (loan_id, drawdown_no, drawn_on, amount, notes, status, agreed_month, document_id, created_by)
      OUTPUT INSERTED.drawdown_id AS id
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`,
    [
      loan.loan_id, noRow[0].n, date(body.drawn_on), amount,
      str(body.notes, 500),
      DRAWDOWN_STATUSES.has(body.status) ? body.status : 'Released',
      Number.isFinite(agreedMonth) ? agreedMonth : null,
      Number.isFinite(documentId) ? documentId : null,
      actorId(req),
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'DRAWDOWN_RELEASED', moduleKey: MODULE_KEY,
    entityName: 'loans', entityId: String(loan.loan_id),
    details: { drawdown_id: out[0].id, drawdown_no: noRow[0].n, amount, agreed_month: agreedMonth },
  }));
  // Client 22-10-2026: the drawdown's net is added to the net loan / outstanding at once.
  await syncOutstanding(loan.loan_id).catch((e) => console.warn('[portfolio] outstanding sync failed:', e.message)); // eslint-disable-line no-console
  return { ok: true, id: out[0].id };
}

async function createCovenant(loanKey, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Covenants can only be added on active facilities' } };
  const errors = {};
  if (!str(body.name, 200)) errors.name = 'Covenant name is required';
  if (body.next_due != null && body.next_due !== '' && !date(body.next_due)) errors.next_due = 'Next due date is invalid';
  if (Object.keys(errors).length) return { ok: false, errors };
  const out = await db.query(
    `INSERT INTO loan_covenants (loan_id, name, covenant_type, frequency, next_due, status, notes, created_by)
      OUTPUT INSERTED.covenant_id AS id
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)`,
    [
      loan.loan_id, str(body.name, 200), str(body.covenant_type, 40), str(body.frequency, 40),
      body.next_due ? date(body.next_due) : null,
      COVENANT_STATUSES.has(body.status) ? body.status : 'Upcoming',
      str(body.notes, 500), actorId(req),
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'COVENANT_ADDED', moduleKey: MODULE_KEY,
    entityName: 'loans', entityId: String(loan.loan_id),
    details: { covenant_id: out[0].id, name: str(body.name, 200) },
  }));
  return { ok: true, id: out[0].id };
}

async function updateCovenant(loanKey, covenantId, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const rows = await db.query(
    'SELECT covenant_id FROM loan_covenants WHERE covenant_id = @p0 AND loan_id = @p1 AND flag_deleted = 0',
    [Number(covenantId), loan.loan_id],
  );
  if (!rows.length) return { ok: false, notFound: true };
  const errors = {};
  if (body.status != null && !COVENANT_STATUSES.has(body.status)) errors.status = 'Status must be a valid covenant status';
  if (body.next_due != null && body.next_due !== '' && !date(body.next_due)) errors.next_due = 'Next due date is invalid';
  if (Object.keys(errors).length) return { ok: false, errors };
  const sets = [];
  const params = [Number(covenantId)];
  if (body.status != null) {
    sets.push(`status = @p${params.length}`);
    params.push(body.status);
  }
  if (body.next_due != null) {
    sets.push(`next_due = @p${params.length}`);
    params.push(body.next_due === '' ? null : date(body.next_due));
  }
  if (body.notes != null) {
    sets.push(`notes = @p${params.length}`);
    params.push(str(body.notes, 500));
  }
  if (!sets.length) return { ok: true, id: Number(covenantId) };
  sets.push(`updated_by = @p${params.length}`);
  params.push(actorId(req));
  sets.push('updated_at = SYSUTCDATETIME()');
  await db.query(
    `UPDATE loan_covenants SET ${sets.join(', ')} WHERE covenant_id = @p0`,
    params,
  );
  await audit.write(audit.fromReq(req, {
    action: 'COVENANT_UPDATED', moduleKey: MODULE_KEY,
    entityName: 'loans', entityId: String(loan.loan_id),
    details: { covenant_id: Number(covenantId), status: body.status || undefined },
  }));
  return { ok: true, id: Number(covenantId) };
}

async function uploadFacilityDocument(loanKey, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const out = await application.addDocument(loan.application_id, body, req);
  if (!out.ok || out.notFound) return out;
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_FACILITY_DOC_UPLOAD',
    moduleKey: MODULE_KEY,
    entityName: 'loans',
    entityId: String(loan.loan_id),
    details: { application_id: loan.application_id, app_document_id: out.id },
  }));
  return out;
}

async function deleteFacilityDocument(loanKey, docId, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const doc = await application.getDocument(loan.application_id, Number(docId));
  if (!doc) return { ok: false, notFound: true };
  await application.deleteDocument(loan.application_id, Number(docId), req);
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_FACILITY_DOC_DELETE', moduleKey: MODULE_KEY,
    entityName: 'loans', entityId: String(loan.loan_id),
    details: { application_id: loan.application_id, app_document_id: Number(docId) },
  }));
  return { ok: true };
}

async function deleteCustomerDocument(applicantId, docId, req) {
  const doc = await customerDocumentFile(applicantId, docId);
  if (!doc) return { ok: false, notFound: true };
  await db.query(
    `UPDATE application_documents SET flag_deleted = 1, updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE app_document_id = @p0 AND flag_deleted = 0
        AND application_id IN (
          SELECT a.application_id FROM applications a
          JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p1)`,
    [Number(docId), Number(applicantId), actorId(req)],
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_CUSTOMER_DOC_DELETE', moduleKey: MODULE_KEY,
    entityName: 'applicants', entityId: String(applicantId),
    details: { app_document_id: Number(docId) },
  }));
  return { ok: true };
}

/** Soft-delete an ENQUIRY document shown on Customer 360 (scoped to the customer's converted enquiries). */
async function deleteCustomerEnquiryDocument(applicantId, docId, req) {
  const doc = await customerEnquiryDocumentFile(applicantId, docId);
  if (!doc) return { ok: false, notFound: true };
  await db.query(
    `UPDATE d SET d.flag_deleted = 1, d.updated_by = @p2, d.updated_at = SYSUTCDATETIME()
       FROM enquiry_documents d
       JOIN enquiries e ON e.enquiry_id = d.enquiry_id
      WHERE d.enquiry_document_id = @p0 AND d.flag_deleted = 0
        AND e.converted_application_id IN (
          SELECT a.application_id FROM applications a
          JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p1)`,
    [Number(docId), Number(applicantId), actorId(req)],
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_CUSTOMER_DOC_DELETE', moduleKey: MODULE_KEY,
    entityName: 'applicants', entityId: String(applicantId),
    details: { enquiry_document_id: Number(docId) },
  }));
  return { ok: true };
}

async function updateFee(loanKey, feeId, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const rows = await db.query(
    'SELECT fee_id FROM loan_fees WHERE fee_id = @p0 AND loan_id = @p1 AND flag_deleted = 0',
    [Number(feeId), loan.loan_id],
  );
  if (!rows.length) return { ok: false, notFound: true };
  const errors = {};
  if (body.fee_type != null && !FEE_TYPES.has(body.fee_type)) errors.fee_type = 'Fee type must be a valid fee type';
  const amount = num(body.amount);
  if (body.amount != null && (!amount || amount <= 0)) errors.amount = 'Amount must be greater than zero';
  if (body.due_date != null && body.due_date !== '' && !date(body.due_date)) errors.due_date = 'Due date is invalid';
  if (body.status != null && !FEE_STATUSES.has(body.status)) errors.status = 'Invalid fee status';
  if (Object.keys(errors).length) return { ok: false, errors };
  const sets = [];
  const params = [Number(feeId)];
  const add = (col, val) => { sets.push(`${col} = @p${params.length}`); params.push(val); };
  if (body.fee_type != null) add('fee_type', str(body.fee_type, 40));
  if (body.amount != null) add('amount', amount);
  if (body.due_date !== undefined) add('due_date', body.due_date ? date(body.due_date) : null);
  if (body.status != null) add('status', body.status);
  if (body.notes !== undefined) add('notes', str(body.notes, 500));
  if (sets.length) {
    add('updated_by', actorId(req));
    await db.query(`UPDATE loan_fees SET ${sets.join(', ')}, updated_at = SYSUTCDATETIME() WHERE fee_id = @p0`, params);
  }
  // An extension waiting on its upfront fees completes once none is Due (client 28-10-2026).
  if (body.status != null) await extensionSvc.syncCompletion(loan.loan_id).catch(() => 0);
  await audit.write(audit.fromReq(req, {
    action: 'FEE_UPDATED', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loan.loan_id),
    details: { fee_id: Number(feeId) },
  }));
  return { ok: true, id: Number(feeId) };
}

async function deleteFee(loanKey, feeId, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const rows = await db.query(
    'SELECT fee_id FROM loan_fees WHERE fee_id = @p0 AND loan_id = @p1 AND flag_deleted = 0',
    [Number(feeId), loan.loan_id],
  );
  if (!rows.length) return { ok: false, notFound: true };
  await db.query(
    `UPDATE loan_fees SET flag_deleted = 1, deleted_on = SYSUTCDATETIME(), updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE fee_id = @p0 AND loan_id = @p1 AND flag_deleted = 0`,
    [Number(feeId), loan.loan_id, actorId(req)],
  );
  await audit.write(audit.fromReq(req, {
    action: 'FEE_DELETED', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loan.loan_id),
    details: { fee_id: Number(feeId) },
  }));
  await extensionSvc.syncCompletion(loan.loan_id).catch(() => 0);
  return { ok: true, id: Number(feeId) };
}

/**
 * Edit a customer's basic details (client 16-10-2026) - e.g. a better phone number.
 * Only the fields sent are changed; old -> new values go to the audit log.
 */
const CUSTOMER_EDIT_FIELDS = ['first_name', 'last_name', 'company_name', 'email', 'phone'];
async function updateCustomer(applicantId, body = {}, req) {
  const id = Number(applicantId);
  if (!id) return { ok: false, notFound: true };
  const cur = await db.query(
    `SELECT TOP 1 applicant_id, first_name, last_name, company_name, email, phone
       FROM applicants WHERE applicant_id = @p0 AND flag_deleted = 0`, [id]);
  if (!cur.length) return { ok: false, notFound: true };
  const old = cur[0];
  const next = {};
  for (const k of CUSTOMER_EDIT_FIELDS) {
    if (body[k] === undefined) continue;
    const v = body[k] === null ? '' : String(body[k]).trim();
    next[k] = v === '' ? null : v;
  }
  const errors = {};
  const max = { first_name: 100, last_name: 100, company_name: 200, email: 150, phone: 30 };
  for (const [k, v] of Object.entries(next)) if (v && v.length > max[k]) errors[k] = `Max ${max[k]} characters`;
  if (next.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email)) errors.email = 'Enter a valid e-mail address';
  if (next.phone && !/^[0-9+()\-\s]{6,}$/.test(next.phone)) errors.phone = 'Enter a valid phone number';
  const fn = next.first_name !== undefined ? next.first_name : old.first_name;
  const ln = next.last_name !== undefined ? next.last_name : old.last_name;
  const co = next.company_name !== undefined ? next.company_name : old.company_name;
  if (!fn && !ln && !co) errors.first_name = 'Enter a name or company name';
  if (Object.keys(errors).length) return { ok: false, errors };
  const changed = Object.keys(next).filter((k) => (old[k] ?? null) !== next[k]);
  if (!changed.length) return { ok: true, changed: [] };
  const sets = changed.map((k, i) => `${k} = @p${i + 2}`).join(', ');
  await db.query(
    `UPDATE applicants SET ${sets}, updated_by = @p1, updated_at = SYSUTCDATETIME() WHERE applicant_id = @p0`,
    [id, req && req.userData ? req.userData.userId : null, ...changed.map((k) => next[k])]);
  await audit.write(audit.fromReq(req, {
    action: 'CUSTOMER_UPDATED', moduleKey: 'CUSTOMERS', entityName: 'applicants', entityId: String(id),
    details: Object.fromEntries(changed.map((k) => [k, { from: old[k] ?? null, to: next[k] }])),
  }));
  return { ok: true, changed };
}

async function customerDetail(applicantId) {
  const id = Number(applicantId);
  if (!id) return null;
  const profile = await db.query(
    `SELECT TOP 1 ap.applicant_id, ${customerNameSql('ap')} AS customer_name,
            ap.first_name, ap.last_name, ap.company_name, ap.email, ap.phone,
            at.name AS applicant_type,
            CONVERT(varchar(10), ap.created_at, 23) AS created_at
       FROM applicants ap
       LEFT JOIN applicant_types at ON at.applicant_type_id = ap.applicant_type_id
      WHERE ap.applicant_id = @p0 AND ap.flag_deleted = 0`,
    [id],
  );
  if (!profile.length) return null;
  const [facilities, applications, documents, auditRows, contacts, documentTypes, enquiries, underwriting, enquiryDocs] = await Promise.all([
    db.query(
      `SELECT l.loan_id, l.loan_number, l.application_id, a.application_ref,
              p.name AS product, l.principal, l.rate_pct, l.outstanding_balance,
              CONVERT(varchar(10), l.start_date, 23) AS start_date,
              CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
              l.status,
              COALESCE(ar.arrears_amount, 0) AS arrears_amount,
              ${appNetSql('enq', 'a')} AS net_amount
         FROM loans l
         JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
         JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
         LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
         ${latestGrossApply('enq')}
         LEFT JOIN products p ON p.product_id = a.product_id
         JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0
         LEFT JOIN (
           SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount
             FROM collections
            WHERE flag_deleted = 0 AND status <> 'Closed'
            GROUP BY loan_id
         ) ar ON ar.loan_id = l.loan_id
        WHERE l.flag_deleted = 0
        ORDER BY l.loan_number`,
      [id],
    ),
    db.query(
      `SELECT a.application_id, a.application_ref, st.name AS status, p.name AS product,
              b.branch_name, a.amount_requested,
              CONVERT(varchar(10), a.created_at, 23) AS created_at
         FROM applications a
         JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0
         LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
         LEFT JOIN products p ON p.product_id = a.product_id
         LEFT JOIN branches b ON b.branch_id = a.branch_id
        WHERE a.flag_deleted = 0
        ORDER BY a.application_id DESC`,
      [id],
    ),
    db.query(
      `SELECT d.app_document_id, d.application_id, a.application_ref, d.file_name, d.file_path, d.status,
              d.version, d.verified_status, dt.name AS document_type_name, dt.category AS document_category,
              d.created_at, COALESCE(up.full_name, 'System') AS uploaded_by_name
         FROM application_documents d
         JOIN applications a ON a.application_id = d.application_id AND a.flag_deleted = 0
         JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0
         LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
         LEFT JOIN users up ON up.user_id = d.uploaded_by
        WHERE d.flag_deleted = 0
        ORDER BY d.app_document_id DESC`,
      [id],
    ),
    db.query(
      `SELECT al.audit_id, CONVERT(varchar(10), al.created_at, 23) AS audit_date,
              CONVERT(varchar(8), al.created_at, 108) AS audit_time,
              COALESCE(u.full_name, 'System') AS user_name, r.role_name,
              al.action, al.entity_name, al.entity_id, al.details
         FROM audit_logs al
         LEFT JOIN users u ON u.user_id = al.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE al.entity_name IN ('applications','loans')
          AND al.entity_id IN (
            SELECT CONVERT(varchar(60), a.application_id)
              FROM applications a
              JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0
            UNION
            SELECT CONVERT(varchar(60), l.loan_id)
              FROM loans l
              JOIN application_applicants aa ON aa.application_id = l.application_id AND aa.applicant_id = @p0
          )
        ORDER BY al.created_at DESC, al.audit_id DESC`,
      [id],
    ),
    listContacts({ applicant_id: id }),
    db.query(`SELECT document_type_id AS id, name, category FROM document_types WHERE flag_deleted = 0 AND is_active = 1 ORDER BY name`),
    db.query(
      `SELECT e.enquiry_id, e.enquiry_ref, st.name AS status, e.amount_requested,
              CONVERT(varchar(10), e.created_at, 23) AS created_at,
              CONVERT(varchar(10), e.converted_at, 23) AS converted_at, e.converted_application_id
         FROM enquiries e
         LEFT JOIN enquiry_statuses st ON st.enquiry_status_id = e.enquiry_status_id
        WHERE e.flag_deleted = 0
          AND e.converted_application_id IN (
            SELECT a.application_id FROM applications a
            JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0)
        ORDER BY e.enquiry_id DESC`,
      [id],
    ),
    db.query(
      `SELECT uc.application_id, uc.underwriting_case_id, a.application_ref, uc.status, uc.current_step,
              CONVERT(varchar(10), uc.updated_at, 23) AS updated_at
         FROM underwriting_cases uc
         JOIN applications a ON a.application_id = uc.application_id AND a.flag_deleted = 0
         JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0
        WHERE uc.flag_deleted = 0
        ORDER BY uc.application_id DESC`,
      [id],
    ),
    db.query(
      `SELECT d.enquiry_document_id, d.file_name, e.enquiry_ref, dt.name AS document_type_name,
              CONVERT(varchar(10), d.created_at, 23) AS created_at,
              COALESCE(u.full_name, 'System') AS uploaded_by_name
         FROM enquiry_documents d
         JOIN enquiries e ON e.enquiry_id = d.enquiry_id
         LEFT JOIN document_types dt ON dt.document_type_id = d.document_type_id
         LEFT JOIN users u ON u.user_id = d.uploaded_by
        WHERE d.flag_deleted = 0
          AND e.converted_application_id IN (
            SELECT a.application_id FROM applications a
            JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p0)
        ORDER BY d.enquiry_document_id DESC`,
      [id],
    ),
  ]);
  const allDocuments = [
    ...documents.map((d) => ({
      kind: 'application', doc_id: d.app_document_id, stage: 'Application', source_ref: d.application_ref,
      file_name: d.file_name, document_type_name: d.document_type_name || d.document_category,
      uploaded_by_name: d.uploaded_by_name, created_at: d.created_at, status: d.verified_status || d.status,
    })),
    ...enquiryDocs.map((d) => ({
      kind: 'enquiry', doc_id: d.enquiry_document_id, stage: 'Enquiry', source_ref: d.enquiry_ref,
      file_name: d.file_name, document_type_name: d.document_type_name,
      uploaded_by_name: d.uploaded_by_name, created_at: d.created_at, status: 'Uploaded',
    })),
  ];
  return { profile: profile[0], facilities, applications, documents, audit: auditRows, contacts, documentTypes, enquiries, underwriting, enquiryDocuments: enquiryDocs, allDocuments };
}

async function facilityDocumentFile(loanKey, docId) {
  const loan = await activeLoan(loanKey);
  if (!loan) return null;
  return application.getDocument(loan.application_id, Number(docId));
}

async function customerDocumentFile(applicantId, docId) {
  const rows = await db.query(
    `SELECT d.file_name, d.file_path
       FROM application_documents d
       JOIN applications a ON a.application_id = d.application_id AND a.flag_deleted = 0
       JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p1
      WHERE d.app_document_id = @p0 AND d.flag_deleted = 0`,
    [Number(docId), Number(applicantId)],
  );
  return rows[0] || null;
}

async function customerEnquiryDocumentFile(applicantId, docId) {
  const rows = await db.query(
    `SELECT d.file_name, d.file_path
       FROM enquiry_documents d
       JOIN enquiries e ON e.enquiry_id = d.enquiry_id
      WHERE d.enquiry_document_id = @p0 AND d.flag_deleted = 0
        AND e.converted_application_id IN (
          SELECT a.application_id FROM applications a
          JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_id = @p1)`,
    [Number(docId), Number(applicantId)],
  );
  return rows[0] || null;
}

async function uploadCustomerDocument(applicantId, body, req) {
  const appId = Number(body.application_id);
  if (!appId) return { ok: false, errors: { application_id: 'Application is required' } };
  const rows = await db.query(
    'SELECT 1 AS ok FROM application_applicants WHERE application_id = @p0 AND applicant_id = @p1',
    [appId, Number(applicantId)],
  );
  if (!rows.length) return { ok: false, errors: { application_id: 'Application does not belong to this customer' } };
  const out = await application.addDocument(appId, body, req);
  if (!out.ok || out.notFound) return out;
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_CUSTOMER_DOC_UPLOAD', moduleKey: MODULE_KEY,
    entityName: 'applicants', entityId: String(applicantId),
    details: { application_id: appId, app_document_id: out.id },
  }));
  return out;
}

async function customers() {
  return db.query(
    `SELECT aa.applicant_id, ${customerNameSql('ap')} AS customer_name,
            MAX(at.name) AS applicant_type,
            MAX(ap.company_name) AS company_name,
            MAX(b.branch_name) AS branch_name,
            COUNT(DISTINCT l.loan_id) AS facilities,
            COUNT(DISTINCT a.application_id) AS applications,
            SUM(COALESCE(l.outstanding_balance, l.principal, 0)) AS exposure,
            SUM(COALESCE(ar.arrears_amount, 0)) AS arrears_amount,
            CONVERT(varchar(10), MIN(ap.created_at), 23) AS created_at
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0 AND uc.status = 'In Portfolio'
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       LEFT JOIN applicant_types at ON at.applicant_type_id = ap.applicant_type_id
       LEFT JOIN branches b ON b.branch_id = a.branch_id
       LEFT JOIN (
         SELECT loan_id, SUM(COALESCE(arrears_amount, 0)) AS arrears_amount
           FROM collections
          WHERE flag_deleted = 0 AND status <> 'Closed'
          GROUP BY loan_id
       ) ar ON ar.loan_id = l.loan_id
      WHERE l.flag_deleted = 0 AND l.status = 'Active'
      GROUP BY aa.applicant_id, ${customerNameSql('ap')}
      ORDER BY ${customerNameSql('ap')}`,
  );
}

async function createContact(body, req) {
  const allowed = await contactAllowed();
  const errors = validate(body, false, allowed);
  if (errors) return { ok: false, errors };
  const ctx = await liveLoanContext({
    loanId: Number(body.loan_id),
    applicationId: Number(body.application_id) || null,
    applicantId: Number(body.applicant_id),
  });
  if (!ctx) return { ok: false, errors: { loan_id: 'Select a valid active facility and customer' } };

  let eventId = null;
  try { eventId = await maybeCreateOutlookEvent(ctx, body); } catch (_) { eventId = null; }

  const out = await db.query(
    `INSERT INTO portfolio_contact_logs
       (loan_id, application_id, applicant_id, contact_date, person, method, contact_notes,
        followup_date, outlook_reminder, outlook_event_id, followup_status, contact_outcome, created_by, milestone_month)
     OUTPUT INSERTED.log_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13)`,
    [
      ctx.loan_id, ctx.application_id, ctx.applicant_id, date(body.contact_date), str(body.person, 200),
      str(body.method, 30), str(body.contact_notes, 4000), date(body.followup_date), bool(body.outlook_reminder) ? 1 : 0,
      eventId, str(body.followup_status, 30) || 'Pending', str(body.contact_outcome, 50), actorId(req),
      milestoneMonth(body.milestone_month),
    ],
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_CONTACT_LOG_ADD', moduleKey: MODULE_KEY,
    entityName: 'portfolio_contact_logs', entityId: out[0].id,
    details: { loan_id: ctx.loan_id, application_id: ctx.application_id, applicant_id: ctx.applicant_id },
  }));
  return { ok: true, id: out[0].id };
}

async function updateContact(logId, body, req) {
  const cur = await db.query('SELECT * FROM portfolio_contact_logs WHERE log_id = @p0 AND flag_deleted = 0', [logId]);
  if (!cur.length) return { notFound: true };
  const allowed = await contactAllowed();
  const errors = validate(body, true, allowed, cur[0]);
  if (errors) return { ok: false, errors };

  let ctx = null;
  if (body.loan_id !== undefined || body.applicant_id !== undefined || body.application_id !== undefined) {
    ctx = await liveLoanContext({
      loanId: Number(body.loan_id || cur[0].loan_id),
      applicationId: Number(body.application_id || cur[0].application_id),
      applicantId: Number(body.applicant_id || cur[0].applicant_id),
    });
    if (!ctx) return { ok: false, errors: { loan_id: 'Select a valid active facility and customer' } };
  }

  const sets = [];
  const params = [];
  let i = 0;
  const add = (col, val) => { sets.push(`${col} = @p${i}`); params.push(val); i += 1; };
  if (ctx) {
    add('loan_id', ctx.loan_id);
    add('application_id', ctx.application_id);
    add('applicant_id', ctx.applicant_id);
  }
  if (body.contact_date !== undefined) add('contact_date', date(body.contact_date));
  if (body.person !== undefined) add('person', str(body.person, 200));
  if (body.method !== undefined) add('method', str(body.method, 30));
  if (body.contact_notes !== undefined) add('contact_notes', str(body.contact_notes, 4000));
  if (body.followup_date !== undefined) add('followup_date', date(body.followup_date));
  if (body.outlook_reminder !== undefined) add('outlook_reminder', bool(body.outlook_reminder) ? 1 : 0);
  if (body.followup_status !== undefined) add('followup_status', str(body.followup_status, 30) || 'Pending');
  if (body.contact_outcome !== undefined) add('contact_outcome', str(body.contact_outcome, 50));
  if (body.milestone_month !== undefined) add('milestone_month', milestoneMonth(body.milestone_month));
  const wantsOutlook = body.outlook_reminder !== undefined ? bool(body.outlook_reminder) : !!cur[0].outlook_reminder;
  const finalFollowup = body.followup_date !== undefined ? date(body.followup_date) : cur[0].followup_date;
  if (body.outlook_reminder !== undefined && !wantsOutlook) {
    add('outlook_event_id', null);
  } else if (wantsOutlook && finalFollowup && !cur[0].outlook_event_id) {
    try {
      const eventCtx = ctx || await liveLoanContext({
        loanId: cur[0].loan_id,
        applicationId: cur[0].application_id,
        applicantId: cur[0].applicant_id,
      });
      const eventId = eventCtx ? await maybeCreateOutlookEvent(eventCtx, {
        ...cur[0],
        ...body,
        followup_date: finalFollowup,
        person: body.person !== undefined ? body.person : cur[0].person,
        contact_notes: body.contact_notes !== undefined ? body.contact_notes : cur[0].contact_notes,
        outlook_reminder: true,
      }) : null;
      if (eventId) add('outlook_event_id', eventId);
    } catch (_) { /* keep in-app reminder even if Outlook fails */ }
  }
  if (!sets.length) return { ok: true };
  params.push(actorId(req), logId);
  await db.query(
    `UPDATE portfolio_contact_logs SET ${sets.join(', ')}, updated_by = @p${i}, updated_at = SYSUTCDATETIME()
      WHERE log_id = @p${i + 1}`,
    params,
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_CONTACT_LOG_UPDATE', moduleKey: MODULE_KEY,
    entityName: 'portfolio_contact_logs', entityId: logId,
  }));
  return { ok: true, id: logId };
}

async function deleteContact(logId, req) {
  await db.query(
    `UPDATE portfolio_contact_logs
        SET flag_deleted = 1, deleted_on = SYSUTCDATETIME(), updated_by = @p1, updated_at = SYSUTCDATETIME()
      WHERE log_id = @p0 AND flag_deleted = 0`,
    [logId, actorId(req)],
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_CONTACT_LOG_DELETE', moduleKey: MODULE_KEY,
    entityName: 'portfolio_contact_logs', entityId: logId,
  }));
  return { ok: true };
}

async function overdue() {
  return db.query(
    `SELECT pcl.log_id, pcl.loan_id, l.loan_number, pcl.application_id, a.application_ref,
            pcl.applicant_id, ${customerNameSql('ap')} AS customer_name,
            CONVERT(varchar(10), pcl.followup_date, 23) AS followup_date,
            pcl.person, pcl.method, pcl.contact_notes, pcl.contact_outcome
       FROM portfolio_contact_logs pcl
       JOIN loans l ON l.loan_id = pcl.loan_id
       JOIN applications a ON a.application_id = pcl.application_id
       JOIN applicants ap ON ap.applicant_id = pcl.applicant_id
      WHERE pcl.flag_deleted = 0
        AND pcl.followup_status = 'Overdue'
      ORDER BY pcl.followup_date, pcl.log_id`,
  );
}

async function contactSchedule(loanKey) {
  const key = String(loanKey || '').trim();
  const rows = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.status,
            CONVERT(varchar(10), l.start_date, 23) AS start_date,
            l.term_months,
            CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
            COALESCE(rf.payments_per_year, 0) AS payments_per_year,
            COALESCE(ar.arrears_amount, 0) AS arrears_amount
       FROM loans l
       LEFT JOIN repayment_frequencies rf ON rf.repayment_frequency_id = l.repayment_frequency_id
       LEFT JOIN (SELECT loan_id, SUM(COALESCE(arrears_amount,0)) AS arrears_amount FROM collections WHERE flag_deleted=0 AND status<>'Closed' GROUP BY loan_id) ar ON ar.loan_id = l.loan_id
      WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)`,
    { key },
  );
  const loan = rows[0];
  if (!loan) return null;
  const contacts = await db.query(
    `SELECT log_id, milestone_month, CONVERT(varchar(10), contact_date, 23) AS contact_date, person, method, contact_outcome
       FROM portfolio_contact_logs WHERE loan_id = @p0 AND flag_deleted = 0 ORDER BY contact_date, log_id`,
    [loan.loan_id],
  );
  const start = loan.start_date;
  const term = Number(loan.term_months || 12);
  const monthly = Number(loan.payments_per_year) === 12;
  let months = monthly
    ? Array.from({ length: term }, (_, i) => i + 1)
    : contactCfg.DEFAULT_MILESTONE_MONTHS.filter((m) => m <= term);
  if (!months.length) months = contactCfg.DEFAULT_MILESTONE_MONTHS.slice();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const addMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setMonth(d.getMonth() + n); return d; };
  const win = contactCfg.MATCH_WINDOW_DAYS * 86400000;
  const grace = contactCfg.OVERDUE_GRACE_DAYS * 86400000;
  let overdue = 0, due = 0;
  const milestones = months.map((m) => {
    const d = start ? addMonths(start, m) : null;
    const dueIso = d ? d.toISOString().slice(0, 10) : null;
    // A log explicitly tied to this milestone wins; otherwise fall back to an
    // untied log within the date window (legacy / free logs).
    let matched = contacts.find((c) => Number(c.milestone_month) === m) || null;
    if (!matched && d) {
      matched = contacts.find((c) => c.milestone_month == null
        && Math.abs(new Date(`${c.contact_date}T00:00:00`).getTime() - d.getTime()) <= win) || null;
    }
    let status;
    if (matched) status = 'Done';
    else if (!d) status = 'Upcoming';
    else if (d.getTime() < today.getTime() - grace) { status = 'Overdue'; overdue += 1; }
    else if (d.getTime() <= today.getTime()) { status = 'Due'; due += 1; }
    else status = 'Upcoming';
    return {
      month: m, due_date: dueIso, status,
      log_id: matched ? matched.log_id : null,
      contact_date: matched ? matched.contact_date : null,
      person: matched ? matched.person : null,
      method: matched ? matched.method : null,
      outcome: matched ? matched.contact_outcome : null,
    };
  });
  const rag = (overdue > 0 || Number(loan.arrears_amount || 0) > 0) ? 'At Risk' : 'Green';
  return { loan_number: loan.loan_number, status: loan.status, monthly, rag, overdue, due, milestones };
}

async function listNotes(loanKey) {
  const loan = await activeLoan(loanKey);
  if (!loan) return null;
  return db.query(
    `SELECT n.note_id, n.note, CONVERT(varchar(10), n.created_at, 23) AS created_at,
            COALESCE(u.full_name, 'System') AS created_by_name
       FROM portfolio_notes n LEFT JOIN users u ON u.user_id = n.created_by
      WHERE n.loan_id = @p0 AND n.flag_deleted = 0 ORDER BY n.note_id DESC`,
    [loan.loan_id],
  );
}

async function addNote(loanKey, body, req) {
  const loan = await activeLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const note = str(body.note, 2000);
  if (!note) return { ok: false, errors: { note: 'Note is required' } };
  const out = await db.query(
    'INSERT INTO portfolio_notes (loan_id, note, created_by) OUTPUT INSERTED.note_id AS id VALUES (@p0, @p1, @p2)',
    [loan.loan_id, note, actorId(req)],
  );
  await audit.write(audit.fromReq(req, {
    action: 'PORTFOLIO_NOTE_ADD', moduleKey: MODULE_KEY, entityName: 'loans', entityId: String(loan.loan_id),
    details: { note_id: out[0].id },
  }));
  return { ok: true, id: out[0].id };
}

async function notifyDueContactMilestones() {
  const facs = await liveFacilities();
  const recipients = await notifications.usersWithPermission(MODULE_KEY, 'view');
  let notified = 0;
  for (const f of facs) {
    // eslint-disable-next-line no-await-in-loop
    const sched = await contactSchedule(f.loan_number);
    if (!sched) continue;
    const pending = sched.milestones.filter((m) => m.status === 'Due' || m.status === 'Overdue');
    if (!pending.length) continue;
    const next = pending[0];
    // eslint-disable-next-line no-await-in-loop
    notified += await notifications.createMany(recipients, {
      title: `Portfolio contact ${next.status.toLowerCase()}: ${f.customer_name}`,
      body: `${f.loan_number}: month ${next.month} contact ${next.status.toLowerCase()} (due ${next.due_date || 'n/a'}).`,
      type: 'PORTFOLIO_CONTACT_DUE', link: '/portfolio', entityId: f.loan_id,
    });
  }
  return { notified };
}

async function markPendingOverdue() {
  const rows = await db.query(
    `SELECT pcl.log_id, pcl.loan_id, pcl.application_id, pcl.applicant_id, pcl.person, pcl.followup_date,
            l.loan_number, a.application_ref, ${customerNameSql('ap')} AS customer_name
       FROM portfolio_contact_logs pcl
       JOIN loans l ON l.loan_id = pcl.loan_id
       JOIN applications a ON a.application_id = pcl.application_id
       JOIN applicants ap ON ap.applicant_id = pcl.applicant_id
      WHERE pcl.flag_deleted = 0
        AND pcl.followup_status = 'Pending'
        AND pcl.followup_date <= CONVERT(date, SYSUTCDATETIME())`,
  );
  if (!rows.length) return { updated: 0, notified: 0 };
  await db.query(
    `UPDATE portfolio_contact_logs
        SET followup_status = 'Overdue', updated_at = SYSUTCDATETIME()
      WHERE flag_deleted = 0
        AND followup_status = 'Pending'
        AND followup_date <= CONVERT(date, SYSUTCDATETIME())`,
  );
  const recipients = await notifications.usersWithPermission(MODULE_KEY, 'view');
  let notified = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    notified += await notifications.createMany(recipients, {
      title: `Portfolio follow-up overdue: ${row.customer_name}`,
      body: `${row.person} needs follow-up for ${row.loan_number || row.application_ref}.`,
      type: 'PORTFOLIO_FOLLOWUP_OVERDUE',
      link: '/portfolio',
      entityId: row.log_id,
    });
  }
  return { updated: rows.length, notified };
}

module.exports = {
  MODULE_KEY,
  LOAN_STATUSES,
  markBadDebt,
  updateBadDebtNote,
  recordRecovery,
  writeOff,
  restoreBadDebt,
  listContacts,
  liveFacilitiesPaged,
  customersPaged,
  updateCustomer,
  listContactsPaged,
  portfolioSummary,
  contactLookups,
  liveFacilities,
  facilityDetail,
  customerDetail,
  createFacilityRequest,
  recordPayment,
  createRedemption,
  completeRedemption,
  redeemFromStatement,
  recordFee,
  releaseDrawdown,
  createCovenant,
  updateCovenant,
  uploadFacilityDocument,
  deleteFacilityDocument,
  deleteCustomerDocument,
  deleteCustomerEnquiryDocument,
  customerEnquiryDocumentFile,
  uploadCustomerDocument,
  updateFee,
  deleteFee,
  facilityDocumentFile,
  customerDocumentFile,
  customers,
  createContact,
  updateContact,
  deleteContact,
  overdue,
  markPendingOverdue,
  contactSchedule,
  listNotes,
  addNote,
  notifyDueContactMilestones,
};
