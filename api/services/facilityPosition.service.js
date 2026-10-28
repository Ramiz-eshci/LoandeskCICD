'use strict';

/**
 * Facility position (client 22-10-2026) - ONE place that works out what is lent and what
 * is owed on a facility, used by the facility header, the drawdown summary, the redemption
 * calculator, the statement preview, the sent statement and Redeem Facility, so they can
 * never disagree.
 *
 *   Day 1 net        = the net advance on completion (excl. drawdowns)
 *   Drawdowns        = tranches actually RELEASED (loan_drawdowns, not 'Scheduled'); each
 *                      matched to its agreed tranche (agreed_month) for its net figure
 *   Net loan         = Day 1 net + Σ released drawdown net
 *   Amount paid      = Σ payments recorded on the facility (manual transactions only)
 *   Outstanding      = Net loan - amount paid (never below 0)
 *
 * Interest (loans.rate_pct is a MONTHLY %):
 *   monthly interest = outstanding x rate
 *   daily interest   = monthly x 12 / 365
 *   accrued (daily)  = running balance day by day: + Day 1 net from the start date,
 *                      + each tranche from the day it was released, - each payment from the
 *                      day it was paid
 *   accrued (monthly)= average balance x months elapsed (a started month counts in full)
 *
 * Pure functions - no DB access - so they are unit tested directly.
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const dayMs = 86400000;
const t = (d) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a, b) => Math.max(0, Math.round((t(b) - t(a)) / dayMs));

function addMonthsIso(start, n) {
  const [y, m, d] = start.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, last));
  return x.toISOString().slice(0, 10);
}
/** Whole months between two ISO dates, a started month counting as a full one. */
function monthsInto(start, end) {
  if (!start || !end || end <= start) return 0;
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 > d1) m += 1;
  return Math.max(1, m);
}

function parseTerms(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

/**
 * @param {object} loan       loans row + applications.net_advance / agreed_terms
 * @param {Array}  drawdowns  loan_drawdowns rows (amount = gross, agreed_month, drawn_on, status)
 * @param {Array}  payments   loan_payments rows (paid_on, amount)
 * @param {string} [asOf]     ISO date - only drawdowns / payments on or before it count (default: all)
 */
function position(loan = {}, drawdowns = [], payments = [], asOf = null) {
  const terms = parseTerms(loan.agreed_terms);
  const rate = num(loan.rate_pct) !== null ? Number(loan.rate_pct) : (num(terms.monthly_rate_pct) || 0);
  const principal = num(loan.principal) || 0;
  const agreed = (Array.isArray(terms.drawdowns) ? terms.drawdowns : []).map((d) => ({
    month: d.month != null && d.month !== '' ? Number(d.month) : null,
    gross: r2(d.gross != null ? d.gross : d.amount),
    net: d.net != null ? r2(d.net) : null,
  }));
  const agreedGross = r2(agreed.reduce((s, d) => s + d.gross, 0));
  const agreedNet = r2(agreed.reduce((s, d) => s + (d.net != null ? d.net : d.gross), 0));

  // Day 1 net: net_advance is the day-1 net; rows from the old "Edit loan" stored the total
  // incl. drawdowns there - detect that against the agreed terms and take the day-1 figure.
  const inclTerms = num(terms.net_release_incl_drawdowns);
  const day1Terms = num(terms.net_release_day1);
  let day1Net = num(loan.net_advance);
  if (day1Net !== null && agreed.length && inclTerms !== null && Math.abs(day1Net - inclTerms) < 0.01) {
    day1Net = day1Terms !== null ? day1Terms : r2(day1Net - agreedNet);
  }
  if (day1Net === null) day1Net = day1Terms !== null ? day1Terms : principal;
  const day1Gross = agreed.length && principal > agreedGross ? r2(principal - agreedGross) : principal;

  const cut = asOf ? iso(asOf) : null;
  const byMonth = new Map(agreed.filter((d) => d.month !== null).map((d) => [d.month, d]));
  const tranches = (drawdowns || [])
    .filter((d) => String(d.status || 'Released') !== 'Scheduled' && iso(d.drawn_on))
    .filter((d) => !cut || iso(d.drawn_on) <= cut)
    .map((d) => {
      const plan = d.agreed_month != null ? byMonth.get(Number(d.agreed_month)) : null;
      const gross = r2(num(d.amount) !== null ? d.amount : (plan ? plan.gross : 0));
      const net = plan && plan.net != null ? plan.net : gross;
      return { date: iso(d.drawn_on), month: plan ? plan.month : null, gross, net: r2(net) };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const ddNet = r2(tranches.reduce((s, x) => s + x.net, 0));
  const ddGross = r2(tranches.reduce((s, x) => s + x.gross, 0));

  const pays = (payments || [])
    .filter((p) => iso(p.paid_on) && (!cut || iso(p.paid_on) <= cut))
    .map((p) => ({ date: iso(p.paid_on), amount: r2(p.amount) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const paid = r2(pays.reduce((s, p) => s + p.amount, 0));

  const netLoan = r2(day1Net + ddNet);
  const outstanding = r2(Math.max(0, netLoan - paid));
  const grossDrawn = r2(day1Gross + ddGross);
  // Client 23-10-2026 (option A): what the borrower owes = the GROSS loan (incl. agreed
  // drawdowns, retained interest, fees) - payments. The header's Amount Outstanding and,
  // since 27-10-2026, the redemption calculator's Outstanding Principal.
  const grossOwed = principal || grossDrawn;
  const grossOutstanding = r2(Math.max(0, grossOwed - paid));
  return {
    rate, start: iso(loan.start_date), maturity: iso(loan.maturity_date),
    principal, day1Gross, day1Net: r2(day1Net),
    agreed, agreedGross, agreedNet,
    tranches, drawdownNet: ddNet, drawdownGross: ddGross,
    grossDrawn, grossOwed, grossOutstanding,
    netLoan, payments: pays, paid, outstanding,
    monthlyInterest: r2(outstanding * (rate / 100)),
  };
}

/**
 * Interest accrued from the start date to `until` on the running balance
 * (+ day-1 net, + released tranches, - payments).
 */
function accrued(pos, until, basis = 'daily') {
  if (!pos.start || !until || until <= pos.start) return { amount: 0, days: 0, months: 0 };
  const events = [
    { date: pos.start, delta: pos.day1Net },
    ...pos.tranches.filter((x) => x.date < until).map((x) => ({ date: x.date < pos.start ? pos.start : x.date, delta: x.net })),
    ...pos.payments.filter((p) => p.date < until).map((p) => ({ date: p.date < pos.start ? pos.start : p.date, delta: -p.amount })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.delta - a.delta));
  const rate = pos.rate / 100;
  const totalDays = daysBetween(pos.start, until);
  const months = monthsInto(pos.start, until);
  let bal = 0; let balDays = 0;
  for (let i = 0; i < events.length; i += 1) {
    bal = Math.max(0, bal + events[i].delta);
    const from = events[i].date;
    const to = i + 1 < events.length ? events[i + 1].date : until;
    if (to > from) balDays += bal * daysBetween(from, to);
  }
  // daily: Σ balance x days x daily rate. monthly: average balance x months (part month = full).
  const amount = basis === 'monthly'
    ? (totalDays ? (balDays / totalDays) * rate * months : 0)
    : balDays * rate * 12 / 365;
  return { amount: r2(amount), days: totalDays, months };
}

const EXIT_TYPES = ['amount', 'months', 'pct_gross', 'pct_net'];

/**
 * Exit fee per the facility's rule:
 *   amount     fixed £
 *   months     N months' interest on the outstanding
 *   pct_gross  % of the gross loan drawn
 *   pct_net    % of the outstanding (net) amount
 *   (none)     an unpaid Exit fee raised on the facility, else 1 month's interest on the
 *              outstanding (offer letter: "exit charge equivalent to 1 months interest")
 */
function exitFee(pos, type, value, feeRows = []) {
  const v = num(value) || 0;
  if (type === 'amount') return { amount: r2(v), basis: 'Fixed amount' };
  if (type === 'months') return { amount: r2(pos.monthlyInterest * v), basis: `${v} month${v === 1 ? '' : 's'}' interest on the outstanding` };
  if (type === 'pct_gross') return { amount: r2(pos.grossDrawn * v / 100), basis: `${v}% of the gross loan drawn` };
  if (type === 'pct_net') return { amount: r2(pos.outstanding * v / 100), basis: `${v}% of the outstanding` };
  const raised = (feeRows || []).filter((f) => String(f.fee_type).toLowerCase() === 'exit' && !['Paid', 'Waived'].includes(String(f.status)));
  if (raised.length) return { amount: r2(raised.reduce((s, f) => s + Number(f.amount || 0), 0)), basis: 'Exit fee raised on the facility' };
  return { amount: pos.monthlyInterest, basis: "1 month's interest on the outstanding" };
}

module.exports = { position, accrued, exitFee, addMonthsIso, monthsInto, EXIT_TYPES, r2, iso };
