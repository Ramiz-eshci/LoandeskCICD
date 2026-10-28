'use strict';

/**
 * Redemption statements (client 30-09-2026).
 *
 *  - Accrued interest basis, chosen per statement (default = the facility's setting):
 *      daily    day by day:           days elapsed x daily interest
 *      monthly  full month they're in: months or part-months elapsed x monthly interest
 *    monthly interest = outstanding x rate % (loans.rate_pct is a MONTHLY rate);
 *    daily interest   = monthly x 12 / 365.
 *  - Minimum interest (months): if redeemed early, at least N months' interest is paid.
 *    Chosen earlier in the process: the Send Offer "Minimum term" (offer_json.min_term_months)
 *    carries to the facility; it can be changed on the facility (loans.min_interest_months).
 *    Default 3.
 *  - The statement PDF is formatted like the other letters and e-mailed to the chosen
 *    recipients - it is NOT saved to the facility documents.
 */

const db = require('../config/database');
const audit = require('./audit.service');
const mail = require('./mail.service');
const emailHub = require('./emailHub.service');
const { buildRedemptionStatementPdf, longDate } = require('./pdf/redemption-pdf.service');
const fp = require('./facilityPosition.service');

const DEFAULT_MIN_MONTHS = 3;
const BASES = ['daily', 'monthly'];
// Exit fee options (client 16-10-2026): fixed £, N months' interest, or % of gross / net loan.
const EXIT_TYPES = ['amount', 'months', 'pct_gross', 'pct_net'];

const actorId = (req) => (req && req.userData ? req.userData.userId : null);
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const iso = (v) => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const parse = (j) => { try { return j ? JSON.parse(j) : {}; } catch (_) { return {}; } };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = (v) => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const customerNameSql = (a) => `COALESCE(NULLIF(${a}.company_name, ''), LTRIM(RTRIM(CONCAT(COALESCE(${a}.first_name, ''), ' ', COALESCE(${a}.last_name, '')))), ${a}.email, 'Customer')`;

/** Facility + borrower + broker + BDM, by loan_number or loan_id. */
async function loadLoan(loanKey) {
  const key = String(loanKey || '').trim();
  const rows = await db.queryNamed(
    `SELECT TOP 1 l.loan_id, l.loan_number, l.application_id, l.status, l.principal, l.outstanding_balance, l.rate_pct,
            CONVERT(varchar(10), l.start_date, 23) AS start_date, CONVERT(varchar(10), l.maturity_date, 23) AS maturity_date,
            l.min_interest_months, l.redemption_interest_basis, l.term_months, l.exit_fee_type, l.exit_fee_value,
            a.application_ref, a.enquiry_id, a.net_advance, a.agreed_terms,
            ${customerNameSql('ap')} AS borrower_name, ap.email AS borrower_email,
            sec.property_address AS security_address,
            br.name AS broker_name, br.email AS broker_email,
            bdm.full_name AS bdm_name, bdm.email AS bdm_email
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id
       JOIN application_applicants aa ON aa.application_id = a.application_id
       JOIN applicants ap ON ap.applicant_id = aa.applicant_id AND ap.flag_deleted = 0
       LEFT JOIN enquiries en ON en.enquiry_id = a.enquiry_id
       LEFT JOIN brokers br ON br.broker_id = en.broker_id
       LEFT JOIN users bdm ON bdm.user_id = COALESCE(a.assigned_to, en.assigned_to)
       OUTER APPLY (SELECT TOP 1 s.property_address FROM application_security s
                     WHERE s.application_id = a.application_id AND s.flag_deleted = 0 ORDER BY s.security_id) sec
      WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)
      ORDER BY CASE WHEN aa.applicant_role = 'Primary' THEN 0 ELSE 1 END, aa.applicant_id`, { key });
  return rows[0] || null;
}

/** Minimum months: facility setting -> accepted offer "minimum term" -> 3. */
async function settings(loan) {
  let minMonths = num(loan.min_interest_months);
  let source = 'facility';
  if (minMonths === null && loan.enquiry_id) {
    try {
      const o = await db.query(
        `SELECT TOP 1 offer_json FROM enquiry_offers WHERE enquiry_id = @p0 AND flag_deleted = 0
          ORDER BY CASE WHEN status = 'Accepted' THEN 0 ELSE 1 END, version_no DESC`, [loan.enquiry_id]);
      const v = o.length ? num(parse(o[0].offer_json).min_term_months) : null;
      if (v !== null) { minMonths = v; source = 'offer'; }
    } catch (_) { /* no offers table / row */ }
  }
  if (minMonths === null) { minMonths = DEFAULT_MIN_MONTHS; source = 'default'; }
  const basis = BASES.includes(loan.redemption_interest_basis) ? loan.redemption_interest_basis : 'daily';
  const exitType = EXIT_TYPES.includes(loan.exit_fee_type) ? loan.exit_fee_type : null;
  return {
    min_interest_months: minMonths, interest_basis: basis, min_source: source,
    exit_fee_type: exitType, exit_fee_value: exitType ? num(loan.exit_fee_value) : null,
  };
}

/**
 * The redemption fixed by Redeem Facility (latest Completed statement): its full amount
 * (principal + interest + fees, before any payment). null when none.
 */
async function fixedRedemption(loanId) {
  const reds = await db.query(
    `SELECT TOP 1 redemption_id, total_amount FROM loan_redemptions
      WHERE loan_id=@p0 AND flag_deleted=0 AND status='Completed' ORDER BY completed_at DESC, redemption_id DESC`, [loanId]);
  if (!reds.length) return null;
  let fixed = null;
  try {
    const j = await db.query('SELECT figures_json FROM loan_redemptions WHERE redemption_id=@p0', [reds[0].redemption_id]);
    fixed = j[0] && j[0].figures_json ? JSON.parse(j[0].figures_json) : null;
  } catch (_) { fixed = null; }
  if (!fixed) fixed = { total_amount: Number(reds[0].total_amount || 0), amount_paid: 0 };
  return { redemption_id: reds[0].redemption_id, required: Math.round((Number(fixed.total_amount || 0) + Number(fixed.amount_paid || 0)) * 100) / 100 };
}

/** Drawdowns + payments + fees of a facility (inputs of the shared position). */
async function ledger(loanId) {
  const [drawdowns, payments, fees] = await Promise.all([
    db.query(`SELECT CONVERT(varchar(10), drawn_on, 23) AS drawn_on, amount, status, agreed_month
                FROM loan_drawdowns WHERE loan_id = @p0 AND flag_deleted = 0`, [loanId]).catch(() => []),
    db.query(`SELECT CONVERT(varchar(10), paid_on, 23) AS paid_on, amount
                FROM loan_payments WHERE loan_id = @p0 AND flag_deleted = 0`, [loanId]).catch(() => []),
    db.query(`SELECT fee_type, amount, status FROM loan_fees
                WHERE loan_id = @p0 AND flag_deleted = 0 AND status NOT IN ('Waived', 'Capitalised')`, [loanId]).catch(() => []),
  ]);
  return { drawdowns, payments, fees };
}

/**
 * Every figure on the redemption calculator / statement (client 22-10-2026 rewrite):
 *   Outstanding Principal = GROSS loan - payments recorded (client 27-10-2026: same figure as
 *                           the facility header's Amount Outstanding; was net loan - payments)
 *   Accrued Interest      = interest on the running balance to the redemption date
 *   Minimum Interest      = N months' interest on the outstanding; if redeemed before
 *                           start + N months the borrower pays this instead of the accrued
 *                           (shown as the top-up "min_interest_adj")
 *   Other Fees            = document + broker + arrangement: 0 by default (already inside the
 *                           gross, client 27-10-2026), unpaid fees recorded on the facility, or
 *                           a figure typed on the calculator
 *   Exit Fee              = facility rule (see facilityPosition.exitFee); default 1 month's interest
 *   Total                 = principal + accrued + min top-up + other fees + exit - credits
 *                           (anything paid beyond the principal comes off the charges)
 * Nothing here writes to the facility - the outstanding only moves when a payment is recorded.
 */
async function figures(loan, q = {}) {
  const st = await settings(loan);
  const redemptionDate = iso(q.redemption_date) || loan.maturity_date || new Date().toISOString().slice(0, 10);
  const basis = BASES.includes(q.interest_basis) ? q.interest_basis : st.interest_basis;
  const minMonthsIn = num(q.min_interest_months);
  const minMonths = minMonthsIn !== null && minMonthsIn >= 0 ? Math.min(120, Math.round(minMonthsIn)) : st.min_interest_months;
  const { drawdowns, payments, fees } = q._ledger || await ledger(loan.loan_id);

  const pos = fp.position(loan, drawdowns, payments);
  const start = pos.start || redemptionDate;
  const acc = fp.accrued(pos, redemptionDate, basis);
  const monthly = pos.monthlyInterest;
  const daily = r2((monthly * 12) / 365);
  const minInterest = r2(monthly * minMonths);
  const minEnd = minMonths > 0 ? fp.addMonthsIso(start, minMonths) : start;
  const minApplies = minMonths > 0 && redemptionDate < minEnd;
  // Client 23-10-2026 (policy): redeemed inside the minimum term -> interest is FIXED at the
  // minimum (N months x monthly interest), whatever the date - no day count, no top-up.
  const accruedAmt = minApplies ? minInterest : acc.amount;
  const minAdj = 0;

  // Other Fees: the deal's document / broker / arrangement fees are part of the gross loan
  // (Outstanding Principal), so they start at 0 - only unpaid fees recorded on the facility
  // or a figure typed on the calculator are added (client 27-10-2026, no double count).
  const feeByType = (t) => {
    const rows = fees.filter((ff) => String(ff.fee_type).toLowerCase() === t);
    if (!rows.length) return 0;
    return r2(rows.filter((ff) => String(ff.status) !== 'Paid').reduce((s, ff) => s + Number(ff.amount || 0), 0));
  };
  const feeOverride = (v, d) => { const n = num(v); return n !== null && n >= 0 ? r2(n) : d; };
  const documentFee = feeOverride(q.document_fee, feeByType('document'));
  const brokerFee = feeOverride(q.broker_fee, feeByType('broker'));
  const arrangementFee = feeOverride(q.arrangement_fee, feeByType('arrangement'));
  const otherFees = r2(documentFee + brokerFee + arrangementFee);
  const credits = 0;

  // Exit fee: the calculator's choice, else the facility's saved rule, else 1 month's interest.
  // Client 23-10-2026: the rule dropdown is gone - default is always 1 month's interest; a
  // rule is only used when one is passed explicitly (older stored quotes).
  const exitType = EXIT_TYPES.includes(q.exit_fee_type) ? q.exit_fee_type : null;
  const exitValue = exitType ? (num(q.exit_fee_value) !== null ? num(q.exit_fee_value) : num(loan.exit_fee_value)) : null;
  const ex = fp.exitFee(pos, exitType, exitValue, fees);
  const exitCalc = ex.amount;
  const exitOverride = num(q.exit_fee);
  const exitEdited = exitOverride !== null && exitOverride >= 0;
  const exitFinal = exitEdited ? r2(exitOverride) : exitCalc;

  const charges = r2(accruedAmt + minAdj + otherFees + exitFinal - credits);
  // Client 27-10-2026: once Redeem Facility has fixed the redemption (a Completed statement)
  // the calculator shows what is left of that fixed amount - the header's Amount Outstanding -
  // with no further interest or fees on top (they are already inside it).
  const fx = String(loan.status || 'Active') === 'Active' ? await fixedRedemption(loan.loan_id).catch(() => null) : null;
  const fixedLeft = fx ? r2(Math.max(0, fx.required - pos.paid)) : null;
  const principal = pos.grossOutstanding;
  const overpaid = r2(Math.max(0, pos.paid - pos.grossOwed));
  const out = {
    redemption_date: redemptionDate,
    interest_basis: basis,
    min_interest_months: minMonths,
    min_source: st.min_source,
    days_elapsed: acc.days,
    months_charged: acc.months,
    monthly_interest: monthly,
    daily_interest: daily,
    day1_net: pos.day1Net,
    net_principal: pos.netLoan,
    amount_paid: pos.paid,
    principal_amount: principal,
    outstanding_amount: principal,
    principal_paid_off: pos.grossOwed > 0 && principal <= 0,
    gross_amount: pos.grossDrawn,
    is_drawdown_facility: pos.agreed.length > 0,
    drawdown_net: pos.drawdownNet,
    drawdown_gross: pos.drawdownGross,
    drawdowns_released: pos.tranches.length,
    accrued_interest: accruedAmt,
    min_interest: minInterest,
    min_interest_applies: minApplies,
    min_interest_adj: minAdj,
    min_interest_until: minEnd,
    exit_fee: exitFinal,
    exit_fee_calc: exitCalc,
    exit_fee_edited: exitEdited,
    exit_fee_type: exitType,
    exit_fee_value: exitValue,
    exit_fee_rule: ex.basis,
    exit_fee_basis: pos.outstanding,
    document_fee: documentFee,
    broker_fee: brokerFee,
    arrangement_fee: arrangementFee,
    other_fees: otherFees,
    credits,
    total_amount: r2(Math.max(0, principal + charges - overpaid)),
    early: loan.maturity_date ? redemptionDate < loan.maturity_date : false,
  };
  if (!fx) return out;
  return {
    ...out,
    fixed_redemption_id: fx.redemption_id,
    fixed_required: fx.required,
    principal_amount: fixedLeft,
    outstanding_amount: fixedLeft,
    principal_paid_off: fixedLeft <= 0,
    accrued_interest: 0,
    min_interest_applies: false,
    min_interest_adj: 0,
    document_fee: 0,
    broker_fee: 0,
    arrangement_fee: 0,
    other_fees: 0,
    exit_fee: 0,
    credits: 0,
    total_amount: fixedLeft,
  };
}

function pdfInput(loan, f, extra = {}) {
  return {
    ...f,
    loan_number: loan.loan_number,
    reference: extra.reference || null,
    borrower_name: loan.borrower_name,
    security_address: loan.security_address,
    start_date: loan.start_date,
    maturity_date: loan.maturity_date,
    statement_date: extra.statement_date || new Date().toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------- public
async function preview(loanKey, q) {
  const loan = await loadLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const f = await figures(loan, q || {});
  return { ok: true, figures: f, settings: await settings(loan) };
}

async function statementPdf(loanKey, q) {
  const loan = await loadLoan(loanKey);
  if (!loan) return null;
  const f = await figures(loan, q || {});
  return { buf: await buildRedemptionStatementPdf(pdfInput(loan, f)), fileName: fileName(loan, f) };
}

function fileName(loan, f) {
  return `Redemption Statement - ${loan.loan_number} - ${f.redemption_date}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
}

/** Who the statement can go to (Send modal choices). */
async function recipients(loanKey) {
  const loan = await loadLoan(loanKey);
  if (!loan) return null;
  const list = [];
  if (loan.borrower_email) list.push({ key: 'borrower', label: `Borrower – ${loan.borrower_name}`, email: loan.borrower_email });
  if (loan.broker_email) list.push({ key: 'broker', label: `Broker – ${loan.broker_name || 'Broker'}`, email: loan.broker_email });
  return { recipients: list, cc: loan.bdm_email ? [{ label: `BDM – ${loan.bdm_name || ''}`.trim(), email: loan.bdm_email }] : [] };
}

/** Save the facility's default basis / minimum months. */
async function saveSettings(loanKey, body = {}, req) {
  const loan = await loadLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const errors = {};
  const mm = num(body.min_interest_months);
  if (body.min_interest_months !== undefined && (mm === null || mm < 0 || mm > 120 || !Number.isInteger(mm))) errors.min_interest_months = 'Minimum months must be a whole number 0-120';
  if (body.interest_basis !== undefined && !BASES.includes(body.interest_basis)) errors.interest_basis = 'Interest basis must be daily or monthly';
  const ev = num(body.exit_fee_value);
  if (body.exit_fee_type !== undefined && body.exit_fee_type !== null && body.exit_fee_type !== '' && !EXIT_TYPES.includes(body.exit_fee_type)) errors.exit_fee_type = 'Exit fee type is not valid';
  if (body.exit_fee_value !== undefined && body.exit_fee_value !== null && body.exit_fee_value !== '' && (ev === null || ev < 0)) errors.exit_fee_value = 'Exit fee must be 0 or more';
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.query(
    `UPDATE loans SET min_interest_months = COALESCE(@p1, min_interest_months),
            redemption_interest_basis = COALESCE(@p2, redemption_interest_basis),
            exit_fee_type = CASE WHEN @p4 = 1 THEN @p5 ELSE exit_fee_type END,
            exit_fee_value = CASE WHEN @p4 = 1 THEN @p6 ELSE exit_fee_value END,
            updated_by = @p3, updated_at = SYSUTCDATETIME()
      WHERE loan_id = @p0`,
    [loan.loan_id, body.min_interest_months !== undefined ? mm : null, body.interest_basis || null, actorId(req),
      body.exit_fee_type !== undefined ? 1 : 0, EXIT_TYPES.includes(body.exit_fee_type) ? body.exit_fee_type : null,
      EXIT_TYPES.includes(body.exit_fee_type) ? (ev || 0) : null]);
  await audit.write(audit.fromReq(req, {
    action: 'REDEMPTION_SETTINGS_UPDATED', moduleKey: 'PORTFOLIO.FACILITY_REDEMPTION', entityName: 'loans', entityId: String(loan.loan_id),
    details: { min_interest_months: body.min_interest_months, interest_basis: body.interest_basis, exit_fee_type: body.exit_fee_type, exit_fee_value: body.exit_fee_value },
  }));
  return { ok: true, settings: await settings(await loadLoan(loan.loan_id)) };
}

function parseEmails(v) {
  return String(v || '').split(/[;,\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

async function emailStatement(loan, f, buf, name, body, req) {
  const to = parseEmails(body.to);
  const cc = parseEmails(body.cc);
  if (!to.length) return { ok: false, error: 'No recipient e-mail' };
  const note = String(body.message || '').trim();
  // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
  const mailVars = {
    Ref: loan.loan_number, Borrower: loan.borrower_name, RedemptionAmount: gbp(f.total_amount),
    RedemptionDate: longDate(f.redemption_date), Notes: note,
    NotesBlock: note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : '',
  };
  const { subject, html } = emailHub.render('REDEMPTION_STATEMENT', mailVars);
  const r = await mail.sendMail({
    // Email Settings master + Email History (client 17-10-2026)
    event: 'REDEMPTION_STATEMENT', ref: { module: 'REDEMPTION', id: loan.loan_id, number: loan.loan_number }, req,
    vars: mailVars,
    to, cc: cc.length ? cc : undefined,
    subject,
    html,
    attachments: [{ filename: name, buffer: buf, contentType: 'application/pdf' }],
  });
  return { ok: !!r.ok, error: r.ok ? undefined : r.error, to, cc };
}

/**
 * Generate a statement: stores the figures (status Quoted, used by Redeem Facility),
 * builds the PDF and e-mails it to the chosen addresses. Nothing is saved to Documents.
 */
async function create(loanKey, body = {}, req) {
  const loan = await loadLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  if (loan.status !== 'Active') return { ok: false, errors: { loan_id: 'Only active facilities can be redeemed' } };
  if (!iso(body.redemption_date)) return { ok: false, errors: { redemption_date: 'Redemption date is required' } };
  const sendEmail = body.send_email !== false && body.send_email !== 'false';
  if (sendEmail && !parseEmails(body.to).length) return { ok: false, errors: { to: 'Enter at least one e-mail address to send the statement to' } };
  const f = await figures(loan, body);
  const out = await db.query(
    `INSERT INTO loan_redemptions
       (loan_id, application_id, redemption_date, principal_amount, accrued_interest, exit_fee, other_fees, credits, total_amount,
        interest_basis, days_elapsed, months_charged, min_interest_months, min_interest_adj, monthly_interest, daily_interest, created_by)
     OUTPUT INSERTED.redemption_id AS id
     VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p16)`,
    [loan.loan_id, loan.application_id, f.redemption_date, f.principal_amount, r2(f.accrued_interest + f.min_interest_adj), f.exit_fee, f.other_fees,
      f.credits, f.total_amount, f.interest_basis, f.days_elapsed, f.months_charged, f.min_interest_months, f.min_interest_adj,
      f.monthly_interest, f.daily_interest, actorId(req)]);
  const id = out[0].id;
  // Client 22-10-2026: keep the exact figures so a re-opened / re-sent statement matches.
  await db.query('UPDATE loan_redemptions SET figures_json = @p1 WHERE redemption_id = @p0', [id, JSON.stringify(f)])
    .catch((e) => console.warn('[redemption] figures_json not saved (run migrations):', e.message)); // eslint-disable-line no-console
  let sent = { ok: false, error: undefined };
  if (sendEmail) {
    const buf = await buildRedemptionStatementPdf(pdfInput(loan, f, { reference: `RS-${id}` }));
    sent = await emailStatement(loan, f, buf, fileName(loan, f), body, req);
    await markSent(id, sent);
  }
  await audit.write(audit.fromReq(req, {
    action: 'REDEMPTION_STATEMENT_GENERATED', moduleKey: 'PORTFOLIO.FACILITY_REDEMPTION', entityName: 'loans', entityId: String(loan.loan_id),
    details: { redemption_id: id, total_amount: f.total_amount, basis: f.interest_basis, min_months: f.min_interest_months, emailed_to: sent.to, email_error: sent.error },
  }));
  return { ok: true, id, ...f, emailed: sendEmail && sent.ok, error: sendEmail && !sent.ok ? sent.error : undefined };
}

async function markSent(id, sent) {
  await db.query(
    `UPDATE loan_redemptions SET emailed_to = @p1, emailed_cc = @p2, emailed_at = SYSUTCDATETIME(), email_status = @p3, email_error = @p4
      WHERE redemption_id = @p0`,
    [id, (sent.to || []).join(', ') || null, (sent.cc || []).join(', ') || null, sent.ok ? 'Sent' : 'Failed', sent.ok ? null : String(sent.error || '').slice(0, 1000)]);
}

async function storedRow(loan, rid) {
  const rows = await db.query(
    `SELECT redemption_id, CONVERT(varchar(10), redemption_date, 23) AS redemption_date, principal_amount, accrued_interest,
            exit_fee, other_fees, credits, total_amount, interest_basis, days_elapsed, months_charged, min_interest_months,
            min_interest_adj, monthly_interest, daily_interest, CONVERT(varchar(10), created_at, 23) AS statement_date
       FROM loan_redemptions WHERE redemption_id = @p0 AND loan_id = @p1 AND flag_deleted = 0`, [Number(rid) || 0, loan.loan_id]);
  const r = rows[0];
  if (!r) return null;
  let full = null;
  try {
    const j = await db.query('SELECT figures_json FROM loan_redemptions WHERE redemption_id = @p0', [r.redemption_id]);
    full = j[0] && j[0].figures_json ? JSON.parse(j[0].figures_json) : null;
  } catch (_) { full = null; }
  if (full) return { ...full, redemption_id: r.redemption_id, statement_date: r.statement_date };
  // Older statements: stored accrued_interest includes the minimum adjustment.
  return { ...r, accrued_interest: r2(Number(r.accrued_interest || 0) - Number(r.min_interest_adj || 0)), interest_basis: r.interest_basis || 'daily' };
}

/** PDF of a statement already generated (same figures as when it was issued). */
async function storedPdf(loanKey, rid) {
  const loan = await loadLoan(loanKey);
  if (!loan) return null;
  const r = await storedRow(loan, rid);
  if (!r) return null;
  return { buf: await buildRedemptionStatementPdf(pdfInput(loan, r, { reference: `RS-${r.redemption_id}`, statement_date: r.statement_date })), fileName: fileName(loan, r) };
}

async function resend(loanKey, rid, body = {}, req) {
  const loan = await loadLoan(loanKey);
  if (!loan) return { ok: false, notFound: true };
  const r = await storedRow(loan, rid);
  if (!r) return { ok: false, notFound: true };
  if (!parseEmails(body.to).length) return { ok: false, errors: { to: 'Enter at least one e-mail address' } };
  const buf = await buildRedemptionStatementPdf(pdfInput(loan, r, { reference: `RS-${r.redemption_id}`, statement_date: r.statement_date }));
  const sent = await emailStatement(loan, r, buf, fileName(loan, r), body, req);
  await markSent(r.redemption_id, sent);
  await audit.write(audit.fromReq(req, {
    action: 'REDEMPTION_STATEMENT_SENT', moduleKey: 'PORTFOLIO.FACILITY_REDEMPTION', entityName: 'loans', entityId: String(loan.loan_id),
    details: { redemption_id: r.redemption_id, emailed_to: sent.to, error: sent.error },
  }));
  return { ok: true, emailed: sent.ok, error: sent.ok ? undefined : sent.error };
}

module.exports = { preview, statementPdf, storedPdf, recipients, saveSettings, create, resend, figures, settings, ledger, loadLoan, fixedRedemption, monthsInto: fp.monthsInto, addMonthsIso: fp.addMonthsIso };
