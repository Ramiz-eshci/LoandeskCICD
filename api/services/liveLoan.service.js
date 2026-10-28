'use strict';

const db = require('../config/database');
const audit = require('./audit.service');

function actorId(req) {
  return req && req.userData ? req.userData.userId : null;
}

async function input(applicationId) {
  const rows = await db.query(
    `SELECT TOP 1 a.application_ref, a.amount_requested, a.net_advance, a.term_months,
            a.monthly_fee_pct, a.repayment_frequency_id, a.completion_date
       FROM applications a
      WHERE a.application_id = @p0 AND a.flag_deleted = 0`,
    [applicationId],
  );
  if (!rows.length) return { ok: false, error: 'Application not found' };
  const app = rows[0];
  // Client 28-09-2026: underwriting "Date Sent to Solicitor" (Funds to Solicitor step,
  // field funds_date) is the loan START; maturity = start + term. Falls back to the
  // application completion date, then today.
  app.funds_date = await fundsDate(applicationId);
  const principal = Number(app.amount_requested || app.net_advance || 0);
  const term = Number(app.term_months || 0);
  if (!principal || !term) return { ok: false, error: 'Loan amount and term are required before portfolio handoff' };
  return { ok: true, app, principal, term };
}

/** "Date Sent to Solicitor" from the underwriting Funds to Solicitor step, or null. */
async function fundsDate(applicationId) {
  try {
    const r = await db.query(
      `SELECT TOP 1 us.data FROM underwriting_steps us
         JOIN underwriting_cases uc ON uc.underwriting_case_id = us.underwriting_case_id AND uc.flag_deleted = 0
        WHERE uc.application_id = @p0 AND us.step_key = 'funds_completion'
        ORDER BY uc.underwriting_case_id DESC`, [applicationId]);
    if (!r.length || !r[0].data) return null;
    const d = String(((JSON.parse(r[0].data) || {}).fields || {}).funds_date || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch (e) {
    console.error('[liveLoan] could not read Date Sent to Solicitor: ' + e.message);
    return null;
  }
}

/** Loan start: Date Sent to Solicitor, else completion date, else today. */
function startOf(app) {
  if (app.funds_date) return app.funds_date;
  if (app.completion_date) {
    const c = app.completion_date instanceof Date ? app.completion_date.toISOString() : String(app.completion_date);
    return c.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/** (Re)write the instalment rows for a loan from principal / term / monthly rate. */
async function writeSchedule(loanId, principal, term, ratePct, start, req) {
  const principalDue = Math.round((principal / term) * 100) / 100;
  const interestDue = Math.round((principal * Number(ratePct || 0)) || 0) / 100;
  for (let n = 1; n <= term; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM loan_schedules WHERE loan_id = @p0 AND installment_no = @p1)
         INSERT INTO loan_schedules
           (loan_id, installment_no, due_date, principal_due, interest_due, total_due, status, created_by)
         VALUES (@p0, @p1, DATEADD(month, @p1, @p2), @p3, @p4, @p5, 'Due', @p6)`,
      [loanId, n, start, principalDue, interestDue, principalDue + interestDue, actorId(req)],
    );
  }
}

/**
 * Put an untouched facility back in step with the application's agreed figures
 * and rebuild its schedule from scratch. Only called when no payment exists.
 */
async function rebuild(loanId, applicationId, principal, term, ratePct, app, req) {
  const start = startOf(app);
  await db.query(
    `UPDATE loans SET principal = @p1, rate_pct = @p2, term_months = @p3,
            start_date = @p4, maturity_date = DATEADD(day, -1, DATEADD(month, @p3, @p4)),
            outstanding_balance = @p1, updated_by = @p5, updated_at = SYSUTCDATETIME()
      WHERE loan_id = @p0`,
    [loanId, principal, ratePct, term, start, actorId(req)]);
  await db.query('DELETE FROM loan_schedules WHERE loan_id = @p0', [loanId]);
  await writeSchedule(loanId, principal, term, ratePct, start, req);
  await audit.write(audit.fromReq(req, {
    action: 'LIVE_LOAN_RESCHEDULE', moduleKey: 'PORTFOLIO.CONTACT_LOG', entityName: 'loans', entityId: loanId,
    details: { applicationId, principal, term, ratePct },
  }));
  console.log(`[liveLoan] loan ${loanId} re-based: principal ${principal}, term ${term}, rate ${ratePct}`);
}

async function ensure(applicationId, req) {
  const ready = await input(applicationId);
  if (!ready.ok) return ready;
  const { app, principal, term } = ready;

  const rate = Number(app.monthly_fee_pct || 0);
  const existing = await db.query(
    'SELECT TOP 1 loan_id AS id, principal, term_months, rate_pct, start_date FROM loans WHERE application_id = @p0 AND flag_deleted = 0',
    [applicationId]);
  if (existing.length) {
    // The facility already exists. If the agreed figures have since changed (an
    // offer accepted after the first handoff), bring the loan and its schedule
    // back in step - but only while nothing has been paid against it, so a
    // facility with history is never silently rewritten.
    const cur = existing[0];
    const curStart = cur.start_date instanceof Date ? cur.start_date.toISOString().slice(0, 10) : String(cur.start_date || '').slice(0, 10);
    const same = Number(cur.principal) === principal && Number(cur.term_months) === term && Number(cur.rate_pct || 0) === rate
      && (!app.funds_date || curStart === app.funds_date);
    if (!same) {
      const paid = await db.query(
        `SELECT TOP 1 1 AS x FROM loan_payments WHERE loan_id = @p0 AND flag_deleted = 0`, [cur.id]);
      if (paid.length) {
        console.warn(`[liveLoan] loan ${cur.id} figures differ from the application but payments exist - left untouched`);
      } else {
        await rebuild(cur.id, applicationId, principal, term, rate, app, req);
      }
    }
    return { ok: true, loanId: cur.id };
  }

  let loanNumber = String(app.application_ref || `APP-${applicationId}`).replace(/^APP/i, 'FAC');
  const clash = await db.query('SELECT TOP 1 loan_id FROM loans WHERE loan_number = @p0', [loanNumber]);
  if (clash.length) loanNumber = `${loanNumber}-${applicationId}`;
  const start = startOf(app);

  const out = await db.query(
    `INSERT INTO loans
       (loan_number, application_id, principal, rate_pct, term_months, repayment_frequency_id,
        start_date, maturity_date, status, outstanding_balance, created_by)
     OUTPUT INSERTED.loan_id AS id
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5,
        @p6, DATEADD(day, -1, DATEADD(month, @p4, @p6)), 'Active', @p2, @p7)`,
    [loanNumber, applicationId, principal, Number(app.monthly_fee_pct || 0), term, app.repayment_frequency_id || null, start, actorId(req)],
  );

  const loanId = out[0].id;
  await writeSchedule(loanId, principal, term, Number(app.monthly_fee_pct || 0), start, req);

  await audit.write(audit.fromReq(req, {
    action: 'LIVE_LOAN_CREATE',
    moduleKey: 'PORTFOLIO.CONTACT_LOG',
    entityName: 'loans',
    entityId: loanId,
    details: { applicationId, loanNumber },
  }));
  return { ok: true, loanId };
}

module.exports = { input, ensure, rebuild, writeSchedule, fundsDate };
