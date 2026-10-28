'use strict';

/**
 * Reports analytics (client 22-10-2026) - the per-module report builders.
 *
 * Every builder pulls ROW-LEVEL data once (bound, read-only SQL) and aggregates in JS,
 * so one data pull feeds several views of the same chart:
 *   - Number of loans  vs  Value of loans (£)
 *   - by loan size band (Small / Medium / Large)
 *   - month axis that follows the selected date range (quick presets on the page)
 *
 * Chart payload (rendered by front/.../module-report):
 *   { id, title, subtitle?, type, span?: 'full'|'half', format?: 'number'|'currency'|'days',
 *     data, views?: [{ key, label, type?, format?, data }] }
 * When `views` is present the top-level type/data mirror the first view (Excel export
 * and older clients keep working).
 *
 * Sections:
 *   enquiry / application / underwriting / portfolio - module reports
 *   finance  - income & cashflow (interest per month, fees, exit fees, redemptions,
 *              money out vs in, 12-month forecast)
 *   summary  - whole pipeline: Sankey waterfall enquiry -> outcome, stage funnel,
 *              decline reasons, average durations
 *
 * A03: every value is bound via db.queryNamed. Each query is wrapped in safe().
 */

const db = require('../config/database');
const { LATEST_GROSS_APPLY, LOAN_AMOUNT_SQL } = require('../utils/loanAmount');
const APP_CFG = require('../config/application.config');

const CUSTOMER = (a) =>
  `COALESCE(NULLIF(${a}.company_name, ''), NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(${a}.first_name,''),' ',COALESCE(${a}.last_name,'')))), ''), ${a}.email)`;

/* ------------------------------------------------------------------ */
/*  Settings                                                          */
/* ------------------------------------------------------------------ */

/** Loan size bands (gross / loan amount). Edit here to re-band every report. */
const SIZE_BANDS = [
  { key: 'small', label: 'Small (< £250k)', max: 250000 },
  { key: 'medium', label: 'Medium (£250k – £1m)', max: 1000000 },
  { key: 'large', label: 'Large (£1m+)', max: Infinity },
];

/** Underwriting step names as the case screen shows them (config 7/8/9 merge into 6). */
/* Client 23-10-2026: same names / order as the Underwriting listing chips, so the
 * report and the list count the same cases under the same heading. */
const UW_STAGE = {
  1: { order: 1, label: 'Initial Review' },
  2: { order: 2, label: 'Valuation Instruction' },
  3: { order: 3, label: 'KYC / AML' },
  4: { order: 4, label: 'Solicitor Quote' },
  5: { order: 5, label: 'Underwriting Review' },
  6: { order: 5, label: 'Underwriting Review' },
  7: { order: 5, label: 'Underwriting Review' },
  8: { order: 5, label: 'Underwriting Review' },
  9: { order: 5, label: 'Underwriting Review' },
  10: { order: 6, label: 'Final Credit Committee' },
  11: { order: 7, label: 'Funds to Solicitor (Completion)' },
  12: { order: 8, label: 'Completion & Move to Portfolio' },
};
const uwStage = (no) => UW_STAGE[Number(no)] || (Number(no) > 12 ? UW_STAGE[12] : { order: 99, label: `Step ${no}` });
/** Stage of a live case as the listing shows it: New Review cases sit under Awaiting Review. */
const uwListStage = (r) => (r.status === 'New Review' ? { order: 0, label: 'Awaiting Review' }
  : r.status === 'Sent to Credit' ? UW_STAGE[10] : uwStage(r.current_step));

/** Not "Live" on the Underwriting listing (its Live chip excludes these). */
const UW_NOT_LIVE = ['Rejected', 'Closed', 'In Portfolio', 'On Hold', 'Returned to BDM'];
const ROW_CAP = 20000;

/* ------------------------------------------------------------------ */
/*  Small helpers                                                     */
/* ------------------------------------------------------------------ */
const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const pct = (a, b) => (b ? r1((a / b) * 100) : 0);
const sum = (arr, f) => (arr || []).reduce((a, x) => a + n(f ? f(x) : x), 0);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const parseJson = (s) => { if (!s) return {}; if (typeof s === 'object') return s; try { return JSON.parse(s) || {}; } catch (_) { return {}; } };

async function safe(label, fn, fallback) {
  try { return await fn(); } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[reports] ${label} failed:`, e && e.message);
    return fallback;
  }
}

/** JS Date (or ISO / 'YYYY-MM-DD') -> Date at UTC midnight, or null. */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const ymOf = (v) => { const d = toDate(v); return d ? d.toISOString().slice(0, 7) : null; };
const daysBetween = (a, b) => { const x = toDate(a); const y = toDate(b); return x && y ? (y - x) / 86400000 : null; };
function addMonths(d, m) {
  const x = toDate(d); if (!x) return null;
  const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(x.getUTCDate(), last));
  return t;
}
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const inRange = (v, f) => {
  const d = toDate(v); if (!d) return false;
  if (f.from && d < toDate(f.from)) return false;
  if (f.to && d >= new Date(toDate(f.to).getTime() + 86400000)) return false;
  return true;
};

function band(amount) {
  const a = n(amount);
  return SIZE_BANDS.find((b) => a < b.max) || SIZE_BANDS[SIZE_BANDS.length - 1];
}

/**
 * Month axis for trend charts. Follows the selected range; with no range it is the
 * last 12 months. Long ranges keep the latest 36 months.
 */
function monthAxis(f, { forwardMonths = 0 } = {}) {
  const end = f.to ? toDate(f.to) : today();
  let start = f.from ? toDate(f.from) : addMonths(end, -11);
  if (start > end) start = end;
  let s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const e = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + forwardMonths, 1));
  const months = [];
  while (s <= e && months.length < 400) {
    months.push(s);
    s = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1));
  }
  const keep = months.slice(-36 - forwardMonths);
  const multiYear = new Set(keep.map((m) => m.getUTCFullYear())).size > 1;
  return keep.map((m) => ({
    key: m.toISOString().slice(0, 7),
    start: m,
    label: m.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) + (multiYear ? ` ${String(m.getUTCFullYear()).slice(2)}` : ''),
  }));
}
/** Next N calendar months from this month. */
function forwardAxis(months = 12) {
  const t = today();
  const out = [];
  for (let i = 0; i < months; i += 1) {
    const m = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + i, 1));
    out.push({ key: m.toISOString().slice(0, 7), start: m, label: m.toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
  }
  return out;
}

/** Group rows -> Map(label -> rows), keeping first-seen order unless sorted later. */
function groupBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return m;
}

/* ---- chart factories ---- */
const COUNT = { key: 'count', label: 'Number' };
const VALUE = { key: 'value', label: 'Value (£)' };

/** Barlist items for count & value views from grouped rows. */
function barlistViews(groups, amountFn, { sortBy = 'count', limit = 0, countSuffix = '' } = {}) {
  let arr = [...groups.entries()].map(([label, rows]) => ({ label, count: rows.length, value: r2(sum(rows, amountFn)) }));
  arr.sort((a, b) => (sortBy === 'none' ? 0 : b[sortBy] - a[sortBy]));
  if (limit) arr = arr.slice(0, limit);
  return [
    // Client 23-10-2026: Number shows only the number, Value (£) only the value.
    { ...COUNT, type: 'barlist', format: 'number', data: { items: arr.map((x) => ({ label: x.label, value: x.count, display: `${x.count.toLocaleString('en-GB')}${countSuffix}` })) } },
    { ...VALUE, type: 'barlist', format: 'currency', data: { items: [...arr].sort((a, b) => (sortBy === 'none' ? 0 : b.value - a.value)).map((x) => ({ label: x.label, value: x.value, display: gbpShort(x.value) })) } },
  ];
}
function donutViews(groups, amountFn) {
  const arr = [...groups.entries()].map(([label, rows]) => ({ label, count: rows.length, value: r2(sum(rows, amountFn)) }));
  return [
    { ...COUNT, type: 'donut', format: 'number', data: { items: arr.map((x) => ({ label: x.label, value: x.count })) } },
    { ...VALUE, type: 'donut', format: 'currency', data: { items: arr.map((x) => ({ label: x.label, value: x.value })) } },
  ];
}
/**
 * Grouped bar views: groups (x axis) x series (classified per row).
 * seriesFn(row) -> series name (or null to skip).
 */
function barViews(rows, groupFn, seriesNames, seriesFn, amountFn, { groupOrder, limit = 0 } = {}) {
  const groups = groupOrder ? groupOrder.slice() : [];
  const cell = new Map();
  rows.forEach((r) => {
    const g = groupFn(r); const s = seriesFn(r);
    if (g === null || g === undefined || s === null || s === undefined) return;
    if (!groupOrder && !groups.includes(g)) groups.push(g);
    const k = `${g}\u0000${s}`;
    const c = cell.get(k) || { count: 0, value: 0 };
    c.count += 1; c.value += n(amountFn(r));
    cell.set(k, c);
  });
  let gs = groups;
  if (!groupOrder) {
    const tot = (g) => seriesNames.reduce((a, s) => a + ((cell.get(`${g}\u0000${s}`) || {}).count || 0), 0);
    gs = groups.slice().sort((a, b) => tot(b) - tot(a));
  }
  if (limit) gs = gs.slice(0, limit);
  const mk = (field) => ({ seriesNames, groups: gs.map((g) => ({ label: g, values: seriesNames.map((s) => r2((cell.get(`${g}\u0000${s}`) || {})[field] || 0)) })) });
  return [
    { ...COUNT, type: 'bar', format: 'number', data: mk('count') },
    { ...VALUE, type: 'bar', format: 'currency', data: mk('value') },
  ];
}
/** Monthly line views (count & value) for several series of dated rows. */
function trendViews(axis, seriesDefs, chartType = 'line') {
  // seriesDefs: [{ name, rows, dateFn, amountFn }]
  const build = (field) => ({
    labels: axis.map((m) => m.label),
    keys: axis.map((m) => m.key), // drill-down value of each month (detail rows carry 'month')
    seriesNames: seriesDefs.map((s) => s.name),
    series: seriesDefs.map((s) => {
      const by = new Map();
      s.rows.forEach((r) => {
        const k = ymOf(s.dateFn(r)); if (!k) return;
        by.set(k, n(by.get(k)) + (field === 'count' ? 1 : n(s.amountFn(r))));
      });
      return { name: s.name, values: axis.map((m) => r2(by.get(m.key) || 0)), area: true };
    }),
  });
  const toBar = (d) => ({ seriesNames: d.seriesNames, keys: d.keys, groups: d.labels.map((lab, i) => ({ label: lab, values: d.series.map((s) => s.values[i]) })) });
  const c = build('count'); const v = build('value');
  return [
    { ...COUNT, type: chartType, format: 'number', data: chartType === 'bar' ? toBar(c) : c },
    { ...VALUE, type: chartType, format: 'currency', data: chartType === 'bar' ? toBar(v) : v },
  ];
}
/** Non-exclusive series per group (e.g. Enquiries / Applications / Completed). */
function seriesViews(groupEntries, defs, amountFn) {
  const mk = (field) => ({
    seriesNames: defs.map((d) => d.name),
    groups: groupEntries.map(([label, rs]) => ({ label, values: defs.map((d) => { const xs = d.pick(rs); return field === 'count' ? xs.length : r2(sum(xs, amountFn)); }) })),
  });
  return [{ ...COUNT, type: 'bar', format: 'number', data: mk('count') }, { ...VALUE, type: 'bar', format: 'currency', data: mk('value') }];
}
/** Wrap views into a chart (top-level mirrors the first view). */
function chart(id, title, views, extra = {}) {
  const v = Array.isArray(views) ? views : [views];
  return { id, title, type: v[0].type, format: v[0].format, data: v[0].data, views: v.length > 1 ? v : undefined, ...extra };
}
/** Size-band views appended to a BDM-style chart: groups x bands, count & value. */
function bandViews(rows, groupFn, amountFn, limit = 0) {
  const names = SIZE_BANDS.map((b) => b.label);
  const v = barViews(rows, groupFn, names, (r) => band(amountFn(r)).label, amountFn, { limit });
  return [
    { key: 'band_count', label: 'By size · Number', type: 'bar', format: 'number', data: v[0].data },
    { key: 'band_value', label: 'By size · Value', type: 'bar', format: 'currency', data: v[1].data },
  ];
}

function gbpShort(v) {
  const a = Math.abs(n(v));
  if (a >= 1e6) return `£${(n(v) / 1e6).toFixed(2).replace(/\.?0+$/, '')}m`;
  if (a >= 1e4) return `£${Math.round(n(v) / 1e3)}k`;
  if (a >= 1e3) return `£${Math.round(n(v)).toLocaleString('en-GB')}`;
  return `£${Math.round(n(v))}`;
}
const tile = (label, value, caption, icon, extra = {}) => ({ label, value: r2(value), caption, icon, ...extra });
const days = (v) => Math.round(n(v));

/* ------------------------------------------------------------------ */
/*  Data pulls                                                        */
/* ------------------------------------------------------------------ */

/** Enquiries in range (+ how far each one got down the pipeline). */
async function enquiryRows(f, { ignoreStatus = false } = {}) {
  return safe('rpt enquiries', () => db.queryNamed(
    `SELECT TOP (@cap) e.enquiry_id, e.enquiry_ref, e.created_at, s.code AS status_code,
            COALESCE(NULLIF(e.company_name,''), NULLIF(e.applicant_name,''), '—') AS applicant,
            ISNULL(s.name,'Unknown') AS status_name, CAST(ISNULL(s.is_terminal,0) AS INT) AS is_terminal,
            ISNULL(s.sort_order, 999) AS status_sort,
            ISNULL(${LOAN_AMOUNT_SQL},0) AS amount,
            ISNULL(u.full_name,'Unassigned') AS bdm, ISNULL(src.name,'Unknown') AS source,
            ISNULL(p.name,'Unspecified') AS product,
            CASE WHEN EXISTS (SELECT 1 FROM enquiry_indicatives ei WHERE ei.enquiry_id = e.enquiry_id AND ei.flag_deleted = 0 AND ei.sent_at IS NOT NULL) THEN 1 ELSE 0 END AS indicative_sent,
            CASE WHEN EXISTS (SELECT 1 FROM enquiry_offers eo WHERE eo.enquiry_id = e.enquiry_id AND eo.flag_deleted = 0 AND eo.status IN ('Sent','Accepted')) THEN 1 ELSE 0 END AS offer_sent,
            app.application_id, app.created_at AS app_created_at, app.status_code AS app_status_code,
            uc.status AS uw_status, uc.created_at AS uw_created_at,
            ln.loan_id, ln.status AS loan_status, ln.start_date AS loan_start, ln.principal AS loan_principal,
            ISNULL(NULLIF(COALESCE(NULLIF(br.company,''), br.name),''), 'Direct / no broker') AS broker,
            -- Average Time Taken breakdown (client 26-10-2026): Type of Deal, the underwriting
            -- valuation step's JSON (types parsed in JS) and the rep from the Solicitor Quote step.
            e.deal_type, uv.data AS uw_valuation_data,
            COALESCE(NULLIF(JSON_VALUE(ur.data, '$.fields.rep_type'), ''), e.rep_type) AS rep_type
       FROM enquiries e
       LEFT JOIN brokers br ON br.broker_id = e.broker_id
       LEFT JOIN enquiry_statuses s ON s.enquiry_status_id = e.enquiry_status_id
       LEFT JOIN users u ON u.user_id = e.assigned_to
       LEFT JOIN application_sources src ON src.application_source_id = e.application_source_id
       LEFT JOIN products p ON p.product_id = e.product_id
       ${LATEST_GROSS_APPLY}
       OUTER APPLY (SELECT TOP 1 a.application_id, a.created_at, ast.code AS status_code
                      FROM applications a
                      LEFT JOIN application_statuses ast ON ast.application_status_id = a.application_status_id
                     WHERE a.enquiry_id = e.enquiry_id AND a.flag_deleted = 0
                     ORDER BY a.application_id DESC) app
       OUTER APPLY (SELECT TOP 1 x.underwriting_case_id, x.status, x.created_at FROM underwriting_cases x
                     WHERE x.application_id = app.application_id AND x.flag_deleted = 0
                     ORDER BY x.underwriting_case_id DESC) uc
       OUTER APPLY (SELECT TOP 1 s.data FROM underwriting_steps s
                     WHERE s.underwriting_case_id = uc.underwriting_case_id AND s.step_no = 2) uv
       OUTER APPLY (SELECT TOP 1 s.data FROM underwriting_steps s
                     WHERE s.underwriting_case_id = uc.underwriting_case_id AND s.step_no = 4) ur
       OUTER APPLY (SELECT TOP 1 l.loan_id, l.status, l.start_date, l.principal FROM loans l
                     WHERE l.application_id = app.application_id AND l.flag_deleted = 0
                     ORDER BY l.loan_id DESC) ln
      WHERE e.flag_deleted = 0
        AND (@from IS NULL OR e.created_at >= @from)
        AND (@to IS NULL OR e.created_at < DATEADD(day,1,@to))
        AND (@status IS NULL OR s.name = @status)
        AND (@bdm IS NULL OR e.assigned_to = @bdm)
      ORDER BY e.created_at DESC`,
    { cap: ROW_CAP, from: f.from, to: f.to, status: ignoreStatus ? null : f.status, bdm: f.bdm }), []);
}

/** Latest (still standing) decline of each enquiry with its ticked reasons. */
async function declineRows(f) {
  return safe('rpt declines', () => db.queryNamed(
    `SELECT d.enquiry_id, d.previous_status_code, d.declined_at, m.reason_name
       FROM enquiry_declines d
       JOIN enquiries e ON e.enquiry_id = d.enquiry_id AND e.flag_deleted = 0
       LEFT JOIN enquiry_decline_reason_map m ON m.enquiry_decline_id = d.enquiry_decline_id
      WHERE d.reopened_at IS NULL
        AND d.enquiry_decline_id = (SELECT MAX(d2.enquiry_decline_id) FROM enquiry_declines d2 WHERE d2.enquiry_id = d.enquiry_id)
        AND (@from IS NULL OR e.created_at >= @from)
        AND (@to IS NULL OR e.created_at < DATEADD(day,1,@to))
        AND (@bdm IS NULL OR e.assigned_to = @bdm)`,
    { from: f.from, to: f.to, bdm: f.bdm }), []);
}

async function applicationRows(f) {
  return safe('rpt applications', () => db.queryNamed(
    `SELECT TOP (@cap) a.application_id, a.application_ref, a.created_at, st.code AS status_code,
            COALESCE(${CUSTOMER('ap')}, NULLIF(enq.company_name,''), enq.applicant_name, '—') AS customer,
            ISNULL(st.name,'Unknown') AS status_name, CAST(ISNULL(st.is_terminal,0) AS INT) AS is_terminal,
            ISNULL(st.sort_order, 999) AS status_sort,
            ISNULL(a.amount_requested,0) AS amount, ISNULL(u.full_name,'Unassigned') AS bdm,
            ISNULL(p.name,'Unspecified') AS product, enq.created_at AS enq_created_at,
            uc.status AS uw_status, ln.start_date AS completed_on, ln.status AS loan_status,
            ISNULL(NULLIF(COALESCE(NULLIF(br.company,''), br.name),''), 'Direct / no broker') AS broker
       FROM applications a
       LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
       LEFT JOIN users u ON u.user_id = a.assigned_to
       LEFT JOIN products p ON p.product_id = a.product_id
       LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
       LEFT JOIN brokers br ON br.broker_id = COALESCE(a.broker_id, enq.broker_id)
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
       OUTER APPLY (SELECT TOP 1 x.status FROM underwriting_cases x WHERE x.application_id = a.application_id AND x.flag_deleted = 0 ORDER BY x.underwriting_case_id DESC) uc
       OUTER APPLY (SELECT TOP 1 l.start_date, l.status FROM loans l WHERE l.application_id = a.application_id AND l.flag_deleted = 0 ORDER BY l.loan_id DESC) ln
      WHERE a.flag_deleted = 0
        AND (@from IS NULL OR a.created_at >= @from)
        AND (@to IS NULL OR a.created_at < DATEADD(day,1,@to))
        AND (@status IS NULL OR st.name = @status)
        AND (@bdm IS NULL OR a.assigned_to = @bdm)
      ORDER BY a.created_at DESC`,
    { cap: ROW_CAP, from: f.from, to: f.to, status: f.status, bdm: f.bdm }), []);
}

async function caseRows(f) {
  return safe('rpt uw cases', () => db.queryNamed(
    `SELECT TOP (@cap) uc.underwriting_case_id, uc.status, uc.current_step, uc.created_at, uc.accepted_at,
            uc.sla_due_date, uc.closed_reason, uc.updated_at,
            ISNULL(u.full_name,'Unassigned') AS underwriter, ISNULL(a.amount_requested,0) AS amount,
            a.application_ref, ISNULL(${CUSTOMER('ap')}, '—') AS customer,
            ln.start_date AS completed_on,
            ISNULL(NULLIF(COALESCE(NULLIF(br.company,''), br.name),''), 'Direct / no broker') AS broker
       FROM underwriting_cases uc
       JOIN applications a ON a.application_id = uc.application_id AND a.flag_deleted = 0
       LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
       LEFT JOIN brokers br ON br.broker_id = COALESCE(a.broker_id, enq.broker_id)
       LEFT JOIN users u ON u.user_id = uc.underwriter_id
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
       OUTER APPLY (SELECT TOP 1 l.start_date FROM loans l WHERE l.application_id = a.application_id AND l.flag_deleted = 0 ORDER BY l.loan_id DESC) ln
      WHERE uc.flag_deleted = 0
        AND (@from IS NULL OR uc.created_at >= @from)
        AND (@to IS NULL OR uc.created_at < DATEADD(day,1,@to))
        AND (@status IS NULL OR uc.status = @status)
        AND (@bdm IS NULL OR uc.underwriter_id = @bdm)
      ORDER BY uc.created_at DESC`,
    { cap: ROW_CAP, from: f.from, to: f.to, status: f.status, bdm: f.bdm }), []);
}

/**
 * Whole loan book (not date filtered - "in range" figures are worked out per date in JS)
 * with fees, drawdowns, redemptions and payments, modelled per loan.
 */
async function loanBook(f) {
  const loans = await safe('rpt loans', () => db.queryNamed(
    `SELECT TOP (@cap) l.loan_id, l.loan_number, l.principal, l.rate_pct, l.term_months, l.start_date,
            l.maturity_date, l.status, l.outstanding_balance, l.exit_fee_type, l.exit_fee_value,
            l.write_off_amount, a.net_advance, a.agreed_terms, a.exit_fee AS app_exit_fee,
            a.arrangement_fee_pct, enq.interest_type AS enq_interest_type, ISNULL(p.name,'Unspecified') AS product,
            ISNULL(u.full_name,'Unassigned') AS bdm, ISNULL(${CUSTOMER('ap')}, '—') AS customer,
            ISNULL(NULLIF(COALESCE(NULLIF(br.company,''), br.name),''), 'Direct / no broker') AS broker
       FROM loans l
       JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
       LEFT JOIN enquiries enq ON enq.enquiry_id = a.enquiry_id
       LEFT JOIN brokers br ON br.broker_id = COALESCE(a.broker_id, enq.broker_id)
       LEFT JOIN products p ON p.product_id = a.product_id
       LEFT JOIN users u ON u.user_id = a.assigned_to
       LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
       LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
      WHERE l.flag_deleted = 0
        AND (@bdm IS NULL OR a.assigned_to = @bdm)
        AND (@status IS NULL OR l.status = @status)`,
    { cap: ROW_CAP, bdm: f.bdm, status: f.status || null }), []);
  if (!loans.length) return [];
  const ids = new Set(loans.map((l) => l.loan_id));
  const mine = (rows) => (rows || []).filter((r) => ids.has(r.loan_id));
  const [fees, dds, reds, pays] = await Promise.all([
    safe('rpt fees', () => db.queryNamed(
      `SELECT f.loan_id, f.fee_type, f.amount, f.due_date, f.status, f.created_at
         FROM loan_fees f WHERE f.flag_deleted = 0 AND f.status <> 'Waived'`, {}), []),
    safe('rpt drawdowns', () => db.queryNamed(
      `SELECT d.loan_id, d.drawn_on, d.amount, d.status, d.agreed_month
         FROM loan_drawdowns d WHERE d.flag_deleted = 0`, {}), []),
    safe('rpt redemptions', () => db.queryNamed(
      `SELECT r.loan_id, r.redemption_date, r.principal_amount, r.accrued_interest, r.exit_fee, r.total_amount
         FROM loan_redemptions r WHERE r.flag_deleted = 0 AND r.status = 'Completed'`, {}), []),
    safe('rpt payments', () => db.queryNamed(
      `SELECT p.loan_id, p.paid_on, p.amount FROM loan_payments p WHERE p.flag_deleted = 0`, {}), []),
  ]);
  const by = (rows) => groupBy(mine(rows), (r) => r.loan_id);
  const feeBy = by(fees); const ddBy = by(dds); const redBy = by(reds); const payBy = by(pays);
  return loans.map((l) => modelLoan(l, feeBy.get(l.loan_id) || [], ddBy.get(l.loan_id) || [], redBy.get(l.loan_id) || [], payBy.get(l.loan_id) || []));
}

/** Approved loan extensions (client 26-10-2026): when each took effect + the amount extended. */
async function extensionRows() {
  return safe('rpt extensions', () => db.queryNamed(
    `SELECT x.extension_id, x.loan_id, COALESCE(x.applied_at, x.decided_at) AS extended_on,
            ISNULL(x.gross_amount, 0) AS amount
       FROM portfolio_extensions x
      WHERE x.flag_deleted = 0 AND x.status = 'Approved'`, {}), []);
}

/** Per-loan figures used by the portfolio / finance / summary reports. */
function modelLoan(l, fees, dds, reds, pays) {
  const terms = parseJson(l.agreed_terms);
  const rate = n(l.rate_pct) || n(terms.monthly_rate_pct);           // % per month
  // Client 26-10-2026: Retained vs Serviced - the agreed terms, else the enquiry's
  // "Interest financing type", else Serviced (same rule as the portfolio drawdown model).
  const interestType = String(terms.interest_type || l.enq_interest_type || '').toLowerCase() === 'retained' ? 'Retained' : 'Serviced';
  const principal = n(l.principal);
  const start = toDate(l.start_date);
  const agreed = Array.isArray(terms.drawdowns) ? terms.drawdowns : [];
  const agreedGross = sum(agreed, (d) => (d.gross != null ? d.gross : d.amount));
  const day1Gross = agreedGross > 0 && principal > agreedGross ? principal - agreedGross : principal;

  // Released tranches (matched to the agreed plan by month) and still-planned ones.
  const released = dds.filter((d) => String(d.status) !== 'Scheduled');
  const releasedMonths = new Set(released.map((d) => (d.agreed_month != null ? Number(d.agreed_month) : null)).filter((x) => x !== null));
  const planByMonth = new Map(agreed.map((d) => [d.month != null ? Number(d.month) : null, d]));
  const tranches = released.map((d) => {
    const p = d.agreed_month != null ? planByMonth.get(Number(d.agreed_month)) : null;
    return { date: toDate(d.drawn_on), gross: p ? n(p.gross != null ? p.gross : p.amount) : n(d.amount), net: p && p.net != null ? n(p.net) : n(d.amount), released: true };
  });
  const planned = agreed
    .filter((d) => d.month != null && !releasedMonths.has(Number(d.month)))
    .map((d) => ({ date: start ? addMonths(start, Number(d.month)) : null, gross: n(d.gross != null ? d.gross : d.amount), net: d.net != null ? n(d.net) : n(d.gross != null ? d.gross : d.amount), released: false }));
  const drawnGross = day1Gross + sum(tranches, (t) => t.gross);

  // End of interest: redeemed / closed loans end at their (actual) maturity; live loans
  // run to maturity; bad debt / written off earn nothing going forward.
  const status = String(l.status || '');
  const end = toDate(l.maturity_date) || (start && n(l.term_months) ? addMonths(start, n(l.term_months)) : null);
  const live = status === 'Active';

  // Fees.
  const feesOf = (t) => fees.filter((x) => String(x.fee_type).toLowerCase() === t);
  const arrRows = feesOf('arrangement');
  const arrangement = arrRows.length ? sum(arrRows, (x) => x.amount)
    : (n(terms.arrangement_fee) || (n(l.arrangement_fee_pct) ? principal * n(l.arrangement_fee_pct) / 100 : 0));
  const otherFees = fees
    .filter((x) => !['arrangement', 'exit'].includes(String(x.fee_type).toLowerCase()))
    .map((x) => ({ type: x.fee_type, amount: n(x.amount), date: toDate(x.due_date) || toDate(x.created_at) }));
  if (!fees.some((x) => String(x.fee_type).toLowerCase() === 'document') && n(terms.document_fee)) {
    otherFees.push({ type: 'Document', amount: n(terms.document_fee), date: start });
  }

  // Exit fee expected (per facility type, else recorded exit fee rows, else 1 month's interest).
  const totalGrossAll = drawnGross + sum(planned, (t) => t.gross);
  const netAll = n(l.net_advance) || n(terms.net_release_incl_drawdowns) || n(terms.net_release_day1) || principal;
  const t = String(l.exit_fee_type || ''); const v = n(l.exit_fee_value);
  let exitExpected;
  if (t === 'amount') exitExpected = v;
  else if (t === 'months') exitExpected = totalGrossAll * (rate / 100) * v;
  else if (t === 'pct_gross') exitExpected = totalGrossAll * v / 100;
  else if (t === 'pct_net') exitExpected = netAll * v / 100;
  else if (feesOf('exit').length) exitExpected = sum(feesOf('exit'), (x) => x.amount);
  else if (n(l.app_exit_fee)) exitExpected = n(l.app_exit_fee);
  else exitExpected = totalGrossAll * (rate / 100);

  const redemption = reds.length ? reds.slice().sort((a, b) => toDate(b.redemption_date) - toDate(a.redemption_date))[0] : null;
  const day1Net = n(l.net_advance) || n(terms.net_release_day1) || day1Gross;

  return {
    id: l.loan_id, ref: l.loan_number, status, live, product: l.product, bdm: l.bdm, customer: l.customer, broker: l.broker || 'Direct / no broker',
    principal, rate, interestType, start, end, termMonths: n(l.term_months),
    day1Gross, day1Net, drawnGross, totalGross: totalGrossAll, tranches, planned,
    balance: live ? (n(l.outstanding_balance) || drawnGross) : 0,
    arrangement: r2(arrangement), otherFees, exitExpected: r2(exitExpected),
    exitActual: redemption ? n(redemption.exit_fee) : 0,
    redeemedOn: redemption ? toDate(redemption.redemption_date) : (status === 'Redeemed' ? end : null),
    // Principal repaid on redemption (client 26-10-2026 redemptions chart), else the facility.
    redeemedPrincipal: redemption && n(redemption.principal_amount) ? n(redemption.principal_amount) : principal,
    redeemedAmount: redemption ? n(redemption.total_amount) : 0,
    payments: pays.map((p) => ({ date: toDate(p.paid_on), amount: n(p.amount) })),
    writeOff: n(l.write_off_amount),
  };
}

/** Interest a loan earns in calendar month `m` (Date at the 1st), pro-rated by days live. */
function interestInMonth(L, m, { projectFuture = true } = {}) {
  if (!L.start || !L.rate) return 0;
  const mStart = m; const mEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  const now = today();
  let stop = L.end || mEnd;
  if (!L.live && L.redeemedOn) stop = L.redeemedOn;
  if (!L.live && !L.redeemedOn && L.status !== 'Active') stop = L.end && L.end < now ? L.end : now; // bad debt etc.
  const a = L.start > mStart ? L.start : mStart;
  const b = stop < mEnd ? stop : mEnd;
  if (b <= a) return 0;
  if (!projectFuture && a >= now) return 0;
  const frac = (b - a) / (mEnd - mStart);
  const mid = new Date((a.getTime() + b.getTime()) / 2);
  const drawn = L.day1Gross
    + sum(L.tranches.filter((x) => x.date && x.date <= mid), (x) => x.gross)
    + (mid > now ? sum(L.planned.filter((x) => x.date && x.date <= mid), (x) => x.gross) : 0);
  return drawn * (L.rate / 100) * frac;
}

/* ------------------------------------------------------------------ */
/*  Shared derivations                                                */
/* ------------------------------------------------------------------ */


/* ---- Average Time Taken breakdown (client 26-10-2026) ---- */
const NOT_SET = 'Not set';
/** Valuation types on the deal's underwriting valuation step: the accepted / approved
 *  entries, else every entry (same rule as the credit paper). Several -> each counts. */
function valuationTypesOf(e) {
  let f = {};
  try { f = (JSON.parse(e.uw_valuation_data || 'null') || {}).fields || {}; } catch (x) { f = {}; }
  const ents = Array.isArray(f.entries) ? f.entries : [];
  const okEnts = ents.filter((x) => x && ['accepted', 'approved'].includes(String(x.status || '').toLowerCase()));
  const use = okEnts.length ? okEnts : (ents.length ? ents : [f]);
  const types = [...new Set(use.map((x) => String((x && x.valuation_type) || '').trim()).filter(Boolean))];
  return types.length ? types : ['Not instructed'];
}
const repOf = (e) => {
  const r = String(e.rep_type || '').trim().toLowerCase();
  return [r.startsWith('dual') ? 'Dual' : r.startsWith('single') ? 'Single' : NOT_SET];
};
const DURATION_DIMS = [
  { key: 'deal_type', label: 'By Deal Type', of: (e) => [e.deal_type || NOT_SET], order: ['Residential', 'Commercial', 'Mixed', NOT_SET] },
  { key: 'valuation', label: 'By Valuation', of: valuationTypesOf },
  { key: 'rep', label: 'By Rep', of: repOf, order: ['Single', 'Dual', NOT_SET] },
];
/** The three pipeline stages: days for one enquiry, or null when it has not got there. */
const DURATION_STAGES = [
  { label: 'Enquiry → Application', days: (e) => (e.app_created_at ? daysBetween(e.created_at, e.app_created_at) : null) },
  { label: 'Application → Completion', days: (e) => (e.app_created_at && e.loan_start ? daysBetween(e.app_created_at, e.loan_start) : null) },
  { label: 'Enquiry → Completion', days: (e) => (e.loan_start ? daysBetween(e.created_at, e.loan_start) : null) },
];
/** Grouped bars: x = stage, one bar per category = its average days. The legend
 *  carries how many deals of that category reached at least one stage. */
function durationBreakdown(enqs, dim) {
  const ok = (x) => x !== null && x >= 0;
  const byCat = new Map();
  enqs.forEach((e) => dim.of(e).forEach((c) => { if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(e); }));
  const measured = (rs) => rs.filter((e) => DURATION_STAGES.some((s) => ok(s.days(e))));
  let cats = [...byCat.keys()].filter((c) => measured(byCat.get(c)).length);
  cats = dim.order
    ? cats.sort((a, b) => (dim.order.indexOf(a) + 1 || 99) - (dim.order.indexOf(b) + 1 || 99))
    : cats.sort((a, b) => (a === 'Not instructed') - (b === 'Not instructed') || measured(byCat.get(b)).length - measured(byCat.get(a)).length);
  return {
    seriesNames: cats.map((c) => `${c} (${measured(byCat.get(c)).length})`),
    groups: DURATION_STAGES.map((s) => ({
      label: s.label,
      values: cats.map((c) => days(avg(byCat.get(c).map(s.days).filter(ok)))),
    })),
  };
}

/** Business mix per month (client 26-10-2026): average loan amount / interest rate / term of
 *  the loans that completed (started) in each month - a simple average per loan. A month
 *  with no completions is null, so the line shows a gap rather than a misleading zero. */
function businessMixChart(axis, book) {
  const byMonth = groupBy(book.filter((L) => L.start), (L) => ymOf(L.start));
  const line = (name, valueOf, round) => ({
    labels: axis.map((m) => m.label),
    keys: axis.map((m) => m.key),
    series: [{
      name,
      values: axis.map((m) => {
        const xs = (byMonth.get(m.key) || []).map(valueOf).filter((x) => x > 0);
        return xs.length ? round(avg(xs)) : null;
      }),
      area: true,
    }],
  });
  return chart('mix', 'Business Mix per Month', [
    { key: 'amount', label: 'Avg Loan Amount', type: 'line', format: 'currency', data: line('Avg loan amount', (L) => L.principal, Math.round) },
    { key: 'rate', label: 'Avg Interest Rate', type: 'line', format: 'number', data: line('Avg interest rate (% per month)', (L) => L.rate, r2) },
    { key: 'term', label: 'Avg Loan Term', type: 'line', format: 'number', data: line('Avg loan term (months)', (L) => L.termMonths, r1) },
  ], { span: 'full', subtitle: 'Completed loans by the month they started · a gap = no loans that month' });
}

/** Loan book movement (client 26-10-2026): a waterfall from the opening book, each month
 *  stepping up by new loans and down by redemptions, with an end-of-month total bar.
 *  Every movement uses the facility amount, so each end bar = previous + new - redeemed. */
function bookMovementChart(axis, book) {
  if (!axis.length) return chart('book', 'Loan Book Movement', { type: 'waterfall', format: 'currency', data: { items: [] } });
  const first = axis[0].start;
  const inBook = (L, at) => L.start && L.start < at && !(L.redeemedOn && L.redeemedOn < at);
  let running = r2(sum(book.filter((L) => inBook(L, first)), (L) => L.principal));
  const items = [{ label: `Opening ${axis[0].label}`, value: running, kind: 'total' }];
  axis.forEach((m) => {
    const added = book.filter((L) => L.start && ymOf(L.start) === m.key);
    const gone = book.filter((L) => L.redeemedOn && ymOf(L.redeemedOn) === m.key && L.redeemedOn <= today());
    const up = r2(sum(added, (L) => L.principal));
    const down = r2(sum(gone, (L) => L.principal));
    if (up) items.push({ label: `${m.label} · New`, value: up, kind: 'up', count: added.length });
    if (down) items.push({ label: `${m.label} · Redeemed`, value: down, kind: 'down', count: gone.length });
    running = r2(running + up - down);
    items.push({ label: `${m.label} End`, value: running, kind: 'total' });
  });
  return chart('book', 'Loan Book Movement', { type: 'waterfall', format: 'currency', data: { items } },
    { span: 'full', subtitle: 'Green = new loans, red = redemptions, grey = loan book at month end (facility amounts)' });
}

/** Average stage durations (days) for the deals that reached each stage. */
function durationChart(enqs, cases, book) {
  const ok = (x) => x !== null && x >= 0;
  const [ea, ac, ec] = DURATION_STAGES.map((s) => enqs.map(s.days).filter(ok));
  const items = [
    { label: 'Enquiry → Application', value: days(avg(ea)), display: `${days(avg(ea))} days · ${ea.length} deals` },
    { label: 'Application → Completion', value: days(avg(ac)), display: `${days(avg(ac))} days · ${ac.length} deals` },
    { label: 'Enquiry → Completion', value: days(avg(ec)), display: `${days(avg(ec))} days · ${ec.length} deals` },
  ];
  if (book) {
    const terms = book.filter((L) => L.termMonths).map((L) => L.termMonths);
    const red = book.filter((L) => L.redeemedOn && L.start).map((L) => daysBetween(L.start, L.redeemedOn) / 30.44).filter((x) => x > 0);
    items.push({ label: 'Agreed loan term', value: days(avg(terms) * 30.44), display: `${r1(avg(terms))} months avg` });
    items.push({ label: 'Actual life of redeemed loans', value: days(avg(red) * 30.44), display: `${r1(avg(red))} months avg · ${red.length} loans` });
  }
  void cases;
  return chart('durations', 'Average Time Taken', [
    { key: 'all', label: 'All', type: 'barlist', format: 'days', data: { items } },
    ...DURATION_DIMS.map((d) => ({ key: d.key, label: d.label, type: 'bar', format: 'days', data: durationBreakdown(enqs, d) })),
  ]);
}

/** Enquiry outcome exactly as the Enquiries listing tabs count it. */
const enqOutcome = (r) => (r.status_code === 'CONVERTED' ? 'Converted'
  : (r.status_code === 'LOST' || r.status_code === 'CLOSED') ? 'Declined' : 'Live');
const ENQ_OUTCOMES = ['Live', 'Converted', 'Declined'];
/** Decline-reasons bucket for a declined deal with no reason ticked (e.g. Closed). */
const NO_REASON = 'No reason recorded';

const funnel = (id, title, stages, extra = {}) => chart(id, title, [
  { ...COUNT, type: 'funnel', format: 'number', data: { items: stages.map((x) => ({ label: x.label, value: x.count, display: `${x.count.toLocaleString('en-GB')}`, pct: x.pct, drill: x.drill })) } },
  { ...VALUE, type: 'funnel', format: 'currency', data: { items: stages.map((x) => ({ label: x.label, value: x.value, display: gbpShort(x.value), pct: x.pct, drill: x.drill })) } },
], extra);
const radial = (id, title, items, extra = {}) => chart(id, title, { type: 'radial', format: 'percent', data: { items } }, extra);
/** Outcome rings - each outcome as a share of the TOTAL (client 23-10-2026), so the
 *  rings of one report add up to 100% and match the headline counts. */
/** Client 23-10-2026: "Cases by Broker — Completed vs Left" on every module report. */
const BROKER_SERIES = ['Completed', 'Left', 'Declined'];
const brokerChart = (rows, classify, amountFn, subtitle) => chart('broker', 'By Broker — Completed vs Left',
  barViews(rows, (r) => r.broker || 'Direct / no broker', BROKER_SERIES, classify, amountFn, { limit: 12 }),
  { drill: 'broker', subtitle });
const outcomeRates = (title, total, parts) => radial('rates', title, parts.map(([label, rs]) => ({
  label, value: pct(rs.length, total), display: `${rs.length} of ${total}`,
})));
const sizeOf = (amt) => band(amt).label;

/** Enquiry detail rows (+ hidden drill fields). `reasonsOf` adds the decline reasons drill. */
function enquiryDetail(rows, stageOf, reasonsOf) {
  return {
    columns: [
      { key: 'ref', header: 'Reference' }, { key: 'applicant', header: 'Applicant' },
      { key: 'status', header: 'Status' }, { key: 'amount', header: 'Loan Amount', type: 'currency' },
      { key: 'bdm', header: 'BDM' }, { key: 'source', header: 'Source' }, { key: 'created_at', header: 'Created', type: 'date' },
    ],
    rows: rows.map((r) => ({
      ref: r.enquiry_ref, applicant: r.applicant, status: r.status_name, amount: n(r.amount), bdm: r.bdm, source: r.source,
      product: r.product, created_at: r.created_at, outcome: enqOutcome(r), size: sizeOf(r.amount), month: ymOf(r.created_at),
      path: stageOf ? stageOf(r) : undefined, broker: r.broker,
      decline_reason: reasonsOf ? reasonsOf(r) : undefined,
    })),
  };
}

/* ================================================================== */
/*  OVERALL SUMMARY                                                    */
/* ================================================================== */
async function summaryReport(f) {
  const rows = await enquiryRows({ ...f, status: null });
  const amt = (r) => r.amount;
  const completedEnq = (r) => !!(r.loan_id || r.uw_status === 'In Portfolio');
  const rejectedApp = (r) => ['REJECTED', 'WITHDRAWN'].includes(r.app_status_code) || ['Rejected', 'Closed', 'Returned to BDM'].includes(r.uw_status);

  // Where each enquiry ended up - few, clear stages (client 22-10-2026).
  const stage = (r) => {
    if (!r.application_id) return ['Enquiries', enqOutcome(r) === 'Declined' ? 'Declined' : enqOutcome(r) === 'Converted' ? 'Applications' : 'Live enquiries'];
    if (completedEnq(r)) {
      const tail = ['Redeemed', 'Recovered'].includes(r.loan_status) ? 'Redeemed' : ['Bad Debt', 'Written Off'].includes(r.loan_status) ? 'Bad debt' : 'Live loans';
      return ['Enquiries', 'Applications', 'Completed', tail];
    }
    if (rejectedApp(r)) return ['Enquiries', 'Applications', 'Rejected / withdrawn'];
    if (r.uw_status) return ['Enquiries', 'Applications', 'In underwriting'];
    return ['Enquiries', 'Applications', 'Awaiting underwriting'];
  };
  const NODE = {
    Enquiries: '#0f2244', 'Live enquiries': '#eaab00', Declined: '#d64545', Applications: '#3f6ea5',
    'Awaiting underwriting': '#a8bed6', 'In underwriting': '#6b8fb8', 'Rejected / withdrawn': '#e07a7a', Completed: '#2e8b57',
    'Live loans': '#3aa66b', Redeemed: '#8fc79a', 'Bad debt': '#8b1e1e',
  };
  const flows = (field) => {
    const links = new Map();
    rows.forEach((r) => {
      const p = stage(r); const v = field === 'count' ? 1 : n(r.amount);
      for (let i = 0; i < p.length - 1; i += 1) { const k = `${p[i]}\u0000${p[i + 1]}`; links.set(k, n(links.get(k)) + v); }
    });
    const names = new Set(); links.forEach((_, k) => k.split('\u0000').forEach((x) => names.add(x)));
    return {
      nodes: [...names].map((id) => ({ id, label: id, color: NODE[id] || '#94a3b8' })),
      links: [...links.entries()].filter(([, v]) => v > 0).map(([k, v]) => { const [source, target] = k.split('\u0000'); return { source, target, value: r2(v) }; }),
    };
  };

  const apps = rows.filter((r) => r.application_id);
  const uw = rows.filter((r) => r.uw_status);
  const done = rows.filter(completedEnq);
  const declined = rows.filter((r) => enqOutcome(r) === 'Declined');
  const quoted = rows.filter((r) => n(r.indicative_sent) || n(r.offer_sent));
  const ec = done.map((r) => daysBetween(r.created_at, r.loan_start)).filter((x) => x !== null && x >= 0);
  const book = await loanBook({ bdm: f.bdm, status: null });
  const live = book.filter((L) => L.live);
  const st = (label, rs, drill) => ({ label, count: rs.length, value: r2(sum(rs, amt)), pct: pct(rs.length, rows.length), drill });
  const axis = monthAxis(f);

  return {
    kpis: [
      tile('Enquiries', rows.length, gbpShort(sum(rows, amt)), 'bi-file-earmark-text'),
      tile('Applications', apps.length, `${pct(apps.length, rows.length)}% converted`, 'bi-briefcase'),
      tile('Completed', done.length, `${gbpShort(sum(done, (r) => r.loan_principal || r.amount))} lent`, 'bi-trophy', { tone: 'positive' }),
      tile('Live Book', sum(live, (L) => L.balance), `${live.length} facilities`, 'bi-cash-stack', { format: 'currency' }),
      tile('Declined', declined.length, `${pct(declined.length, rows.length)}% of enquiries`, 'bi-x-circle', { tone: 'danger' }),
      tile('Avg Days to Complete', days(avg(ec)), 'Enquiry → completion', 'bi-hourglass-split'),
    ],
    charts: [
      chart('pipeline', 'Where Every Enquiry Went', [
        { ...COUNT, type: 'sankey', format: 'number', data: flows('count') },
        { ...VALUE, type: 'sankey', format: 'currency', data: flows('value') },
      ], { span: 'full', drill: 'path', subtitle: 'Click a stage to list its deals below' }),
      funnel('funnel', 'Pipeline Funnel', [
        st('Enquiries', rows, null), st('Quoted', quoted, null), st('Applications', apps, 'Applications'),
        st('Underwriting', uw, null), st('Completed', done, 'Completed'),
      ], { drill: 'path' }),
      radial('conversion', 'Conversion Rates', [
        { label: 'Enquiry → Application', value: pct(apps.length, rows.length), display: `${apps.length} of ${rows.length}` },
        { label: 'Application → Completion', value: pct(done.length, apps.length), display: `${done.length} of ${apps.length}` },
        { label: 'Enquiry → Completion', value: pct(done.length, rows.length), display: `${done.length} of ${rows.length}` },
      ]),
      chart('monthly', 'Enquiries per Month by Outcome', trendViews(axis, ENQ_OUTCOMES.map((o) => ({
        name: o, rows: rows.filter((r) => enqOutcome(r) === o), dateFn: (r) => r.created_at, amountFn: amt,
      })), 'bar'), { span: 'full', drill: 'month' }),
      chart('bdm', 'Pipeline by BDM', seriesViews([...groupBy(rows, (r) => r.bdm).entries()].sort((a, b) => b[1].length - a[1].length), [
        { name: 'Enquiries', pick: (rs) => rs }, { name: 'Applications', pick: (rs) => rs.filter((r) => r.application_id) },
        { name: 'Completed', pick: (rs) => rs.filter(completedEnq) },
      ], amt), { drill: 'bdm' }),
      durationChart(rows, null, book),
      businessMixChart(axis, book),
      bookMovementChart(axis, book),
    ],
    detail: enquiryDetail(rows, stage),
  };
}

/* ================================================================== */
/*  ENQUIRY                                                            */
/* ================================================================== */
async function enquiryReport(f) {
  const rows = await enquiryRows(f);
  const amt = (r) => r.amount;
  const by = (o) => rows.filter((r) => enqOutcome(r) === o);
  const live = by('Live'); const conv = by('Converted'); const dec = by('Declined');
  const axis = monthAxis(f);
  const statusOrder = [...new Map(rows.map((r) => [r.status_name, n(r.status_sort)])).entries()].sort((a, b) => a[1] - b[1]).map((x) => x[0]);

  // Client 26-10-2026: decline reasons are back as a bar chart. Each declined deal (LOST /
  // CLOSED) counts under every reason ticked on its latest standing decline; a deal with
  // none (e.g. Closed, or declined before reasons existed) is "No reason recorded", so
  // every declined deal shows up.
  const reasonsById = new Map();
  (await declineRows(f)).forEach((d) => {
    if (!d.reason_name) return;
    if (!reasonsById.has(d.enquiry_id)) reasonsById.set(d.enquiry_id, []);
    reasonsById.get(d.enquiry_id).push(d.reason_name);
  });
  const reasonsOf = (r) => (enqOutcome(r) === 'Declined' ? (reasonsById.get(r.enquiry_id) || [NO_REASON]) : undefined);
  const declinedByReason = dec.flatMap((r) => reasonsOf(r).map((reason) => ({ ...r, reason })));

  return {
    kpis: [
      tile('All Enquiries', rows.length, gbpShort(sum(rows, amt)), 'bi-file-earmark-text'),
      tile('Live', live.length, gbpShort(sum(live, amt)), 'bi-inbox', { tone: 'warning' }),
      tile('Converted', conv.length, `${pct(conv.length, rows.length)}% conversion`, 'bi-check2-circle', { tone: 'positive' }),
      tile('Declined', dec.length, `${pct(dec.length, rows.length)}% of enquiries`, 'bi-x-circle', { tone: 'danger' }),
      tile('Avg Loan Size', rows.length ? sum(rows, amt) / rows.length : 0, 'Per enquiry', 'bi-rulers', { format: 'currency' }),
    ],
    charts: [
      chart('outcome', 'Live vs Converted vs Declined', donutViews(new Map(ENQ_OUTCOMES.map((o) => [o, by(o)])), amt), { drill: 'outcome' }),
      outcomeRates('Outcome Rates', rows.length, [['Converted', conv], ['Declined', dec], ['Still live', live]]),
      chart('status', 'Enquiries by Status', barlistViews(new Map(statusOrder.map((s) => [s, rows.filter((r) => r.status_name === s)])), amt, { sortBy: 'none' }), { drill: 'status' }),
      chart('trend', 'Enquiry Trend', trendViews(axis, [
        { name: 'Received', rows, dateFn: (r) => r.created_at, amountFn: amt },
        { name: 'Converted', rows: conv, dateFn: (r) => r.app_created_at || r.created_at, amountFn: amt },
        { name: 'Declined', rows: dec, dateFn: (r) => r.created_at, amountFn: amt },
      ]), { span: 'full', drill: 'month', subtitle: 'Per month in the selected period' }),
      chart('bdm', 'Enquiries by Sales Team (BDM)', [
        ...barViews(rows, (r) => r.bdm, ENQ_OUTCOMES, enqOutcome, amt),
        ...bandViews(rows, (r) => r.bdm, amt),
      ], { drill: 'bdm' }),
      chart('size', 'Enquiries by Loan Size', barViews(rows, (r) => sizeOf(r.amount), ENQ_OUTCOMES, enqOutcome, amt, { groupOrder: SIZE_BANDS.map((b) => b.label) }), { drill: 'size' }),
      chart('source', 'Enquiries by Source', barlistViews(groupBy(rows, (r) => r.source), amt), { drill: 'source' }),
      chart('product', 'Enquiries by Product', barlistViews(groupBy(rows, (r) => r.product), amt), { drill: 'product' }),
      chart('declines', 'Declined Deals by Reason', barViews(declinedByReason, (x) => x.reason, ['Declined'], () => 'Declined', amt), {
        drill: 'decline_reason',
        subtitle: `${dec.length} declined deal${dec.length === 1 ? '' : 's'} · a deal with several reasons counts under each · click a bar to list its deals`,
      }),
      brokerChart(rows, (r) => ({ Converted: 'Completed', Live: 'Left', Declined: 'Declined' }[enqOutcome(r)]), amt,
        'Completed = converted to application · Left = still live · Declined'),
    ],
    detail: enquiryDetail(rows, null, reasonsOf),
  };
}

/* ================================================================== */
/*  APPLICATION                                                        */
/* ================================================================== */
/* Client 23-10-2026: stages + outcomes exactly as the Applications listing chips count them
 * (application.config STAGE_OF): Live = Awaiting Initial Review + Underwriting + Approved. */
const APP_STAGE_LABEL = {
  'awaiting-review': 'Awaiting Initial Review', underwriting: 'Underwriting', approved: 'Approved',
  completed: 'Completed', declined: 'Declined', submitted: 'Other',
};
const APP_STAGE_ORDER = ['awaiting-review', 'underwriting', 'approved', 'completed', 'declined', 'submitted'];
const appStageKey = (code) => APP_CFG.STAGE_OF[String(code || '').toUpperCase()] || 'submitted';
const appStage = (r) => APP_STAGE_LABEL[appStageKey(r.status_code)];
const appOutcome = (r) => {
  const k = appStageKey(r.status_code);
  if (k === 'completed') return 'Completed';
  if (k === 'declined') return 'Declined';
  return ['awaiting-review', 'underwriting', 'approved'].includes(k) ? 'Live' : 'Other';
};

async function applicationReport(f) {
  // Status filter = listing stage (Awaiting Initial Review / Underwriting / ...), applied here.
  const rows = (await applicationRows({ ...f, status: null })).filter((r) => !f.status || appStage(r) === f.status);
  const amt = (r) => r.amount;
  const outcome = appOutcome;
  const OUT = ['Live', 'Completed', 'Declined'];
  const completed = rows.filter((r) => outcome(r) === 'Completed');
  const lost = rows.filter((r) => outcome(r) === 'Declined');
  const active = rows.filter((r) => outcome(r) === 'Live');
  const axis = monthAxis(f);
  const stageGroups = new Map(APP_STAGE_ORDER.map((k) => [APP_STAGE_LABEL[k], rows.filter((r) => appStageKey(r.status_code) === k)])
    .filter(([lab, rs]) => rs.length || lab !== 'Other'));

  return {
    kpis: [
      tile('Applications', rows.length, gbpShort(sum(rows, amt)), 'bi-briefcase'),
      tile('Live Pipeline', active.length, gbpShort(sum(active, amt)), 'bi-folder2-open', { tone: 'warning' }),
      tile('Completed', completed.length, gbpShort(sum(completed, amt)), 'bi-check2-circle', { tone: 'positive' }),
      tile('Declined', lost.length, gbpShort(sum(lost, amt)), 'bi-x-circle', { tone: 'danger' }),
      tile('Avg Loan Size', rows.length ? sum(rows, amt) / rows.length : 0, 'Requested', 'bi-rulers', { format: 'currency' }),
    ],
    charts: [
      chart('status', 'Applications by Stage', barlistViews(stageGroups, amt, { sortBy: 'none' }), { drill: 'status' }),
      outcomeRates('Outcome Rates', rows.length, [['Completed', completed], ['Declined', lost], ['Still live', active]]),
      chart('monthly', 'Applications Received vs Completed', trendViews(axis, [
        { name: 'Received', rows, dateFn: (r) => r.created_at, amountFn: amt },
        { name: 'Completed', rows: completed, dateFn: (r) => r.completed_on || r.created_at, amountFn: amt },
      ], 'bar'), { span: 'full', drill: 'month', subtitle: 'Per month in the selected period' }),
      chart('product', 'Product Mix', donutViews(groupBy(rows, (r) => r.product), amt), { drill: 'product' }),
      chart('bdm', 'Applications by BDM', [
        ...barViews(rows, (r) => r.bdm, OUT, outcome, amt),
        ...bandViews(rows, (r) => r.bdm, amt),
      ], { drill: 'bdm' }),
      chart('size', 'Applications by Loan Size', barViews(rows, (r) => sizeOf(r.amount), OUT, outcome, amt, { groupOrder: SIZE_BANDS.map((b) => b.label) }), { drill: 'size' }),
      brokerChart(rows, (r) => ({ Completed: 'Completed', Live: 'Left', Declined: 'Declined' }[outcome(r)] || null), amt,
        'Completed = completed application · Left = live pipeline · Declined'),
    ],
    detail: {
      columns: [
        { key: 'ref', header: 'Reference' }, { key: 'customer', header: 'Applicant' }, { key: 'product', header: 'Product' },
        { key: 'amount', header: 'Amount', type: 'currency' }, { key: 'status', header: 'Stage' }, { key: 'bdm', header: 'BDM' },
        { key: 'created_at', header: 'Created', type: 'date' },
      ],
      rows: rows.map((r) => ({ ref: r.application_ref, customer: r.customer, product: r.product, amount: n(r.amount), status: appStage(r), bdm: r.bdm, broker: r.broker, created_at: r.created_at, outcome: outcome(r), size: sizeOf(r.amount), month: ymOf(r.created_at) })),
    },
  };
}

/* ================================================================== */
/*  UNDERWRITING                                                       */
/* ================================================================== */
async function underwritingReport(f) {
  const rows = await caseRows(f);
  const amt = (r) => r.amount;
  // Client 23-10-2026: same buckets as the Underwriting listing chips.
  const open = rows.filter((r) => !UW_NOT_LIVE.includes(r.status));
  const approved = rows.filter((r) => r.status === 'In Portfolio');
  const rejected = rows.filter((r) => ['Rejected', 'Closed'].includes(r.status));
  const onHold = rows.filter((r) => r.status === 'On Hold');
  const decided = approved.length + rejected.length;
  const axis = monthAxis(f);
  const stageRows = open.map((r) => ({ ...r, stage: uwListStage(r) }));
  const order = [...new Map(stageRows.map((r) => [r.stage.label, r.stage.order])).entries()].sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  const reasons = rows.filter((r) => ['Rejected', 'Closed'].includes(r.status))
    .map((r) => ({ ...r, reason: (String(r.closed_reason || '').trim().split(/\r?\n/)[0].slice(0, 80)) || 'No reason recorded' }));

  return {
    kpis: [
      tile('Live Cases', open.length, gbpShort(sum(open, amt)), 'bi-clipboard-check'),
      tile('Moved to Portfolio', approved.length, gbpShort(sum(approved, amt)), 'bi-check2-circle', { tone: 'positive' }),
      tile('Declined / Closed', rejected.length, gbpShort(sum(rejected, amt)), 'bi-x-circle', { tone: 'danger' }),
      tile('On Hold', onHold.length, gbpShort(sum(onHold, amt)), 'bi-pause-circle', { tone: onHold.length ? 'warning' : 'default' }),
      tile('Approval Rate', pct(approved.length, decided), `${decided} decided`, 'bi-percent', { format: 'percent' }),
    ],
    charts: [
      chart('step', 'Live Cases by Step', barlistViews(new Map(order.map((lab) => [lab, stageRows.filter((r) => r.stage.label === lab)])), amt, { sortBy: 'none' }), { drill: 'stage' }),
      outcomeRates('Outcome Rates', rows.length, [['Moved to Portfolio', approved], ['Declined / Closed', rejected], ['Still live', open]]),
      chart('opened', 'Cases Opened vs Decided', trendViews(axis, [
        { name: 'Opened', rows, dateFn: (r) => r.created_at, amountFn: amt },
        { name: 'Moved to Portfolio', rows: approved, dateFn: (r) => r.completed_on || r.updated_at, amountFn: amt },
        { name: 'Declined / Closed', rows: rejected, dateFn: (r) => r.updated_at, amountFn: amt },
      ], 'line'), { span: 'full', drill: 'month' }),
      chart('status', 'Cases by Status', donutViews(groupBy(rows, (r) => r.status || 'Unknown'), amt), { drill: 'status' }),
      chart('underwriter', 'Live Cases by Underwriter', barlistViews(groupBy(open, (r) => r.underwriter), amt), { drill: 'underwriter' }),
      // Client 23-10-2026: per broker - how much is completed (moved to portfolio) vs still left.
      brokerChart(rows, (r) => (r.status === 'In Portfolio' ? 'Completed' : ['Rejected', 'Closed'].includes(r.status) ? 'Declined' : 'Left'), amt,
        'Completed = moved to portfolio · Left = still in underwriting (incl. on hold) · Declined = declined / closed'),
      chart('reasons', 'Rejection / Closure Reasons', barlistViews(groupBy(reasons, (r) => r.reason), amt, { limit: 12 })),
    ],
    detail: {
      columns: [
        { key: 'ref', header: 'Application' }, { key: 'customer', header: 'Customer' }, { key: 'status', header: 'Status' },
        { key: 'stage', header: 'Step' }, { key: 'underwriter', header: 'Underwriter' }, { key: 'amount', header: 'Amount', type: 'currency' },
        { key: 'created_at', header: 'Opened', type: 'date' },
      ],
      rows: rows.map((r) => ({
        ref: r.application_ref, customer: r.customer, status: r.status, stage: UW_NOT_LIVE.includes(r.status) ? '—' : uwListStage(r).label,
        underwriter: r.underwriter, amount: n(r.amount), created_at: r.created_at, month: ymOf(r.created_at), broker: r.broker,
      })),
    },
  };
}

/* ================================================================== */
/*  PORTFOLIO                                                          */
/* ================================================================== */
function facilityDetail(book, m0) {
  return {
    columns: [
      { key: 'facility', header: 'Facility' }, { key: 'customer', header: 'Customer' }, { key: 'product', header: 'Product' },
      { key: 'balance', header: 'Balance', type: 'currency' }, { key: 'rate', header: 'Rate % pm', type: 'number' },
      { key: 'monthly_interest', header: 'Interest / Month', type: 'currency' }, { key: 'status', header: 'Status' },
      { key: 'maturity_date', header: 'Maturity', type: 'date' }, { key: 'bdm', header: 'BDM' },
    ],
    rows: book.map((L) => ({
      facility: L.ref, customer: L.customer, product: L.product, balance: r2(L.balance), rate: L.rate,
      monthly_interest: r2(L.live ? interestInMonth(L, m0) : 0), status: L.status, maturity_date: L.end, bdm: L.bdm,
      size: sizeOf(L.totalGross), month: ymOf(L.end), broker: L.broker, arrangement: L.arrangement, exit_expected: L.live ? L.exitExpected : 0, start_date: L.start,
    })),
  };
}

async function portfolioReport(f) {
  const book = await loanBook(f);
  const live = book.filter((L) => L.live);
  const bal = (L) => L.balance;
  const now = today();
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthInterest = sum(live, (L) => interestInMonth(L, m0));
  const wavg = sum(live, bal) ? sum(live, (L) => L.balance * L.rate) / sum(live, bal) : 0;
  const bad = book.filter((L) => L.status === 'Bad Debt');
  const in90 = live.filter((L) => L.end && daysBetween(now, L.end) <= 90);
  const fwd = forwardAxis(12);
  const ladder = (field) => {
    const overdueL = live.filter((L) => L.end && L.end < m0);
    const pick = (ls) => (field === 'count' ? ls.length : r2(sum(ls, bal)));
    return { seriesNames: [field === 'count' ? 'Facilities' : 'Balance'], groups: [{ label: 'Overdue', values: [pick(overdueL)] }, ...fwd.map((m) => ({ label: m.label, values: [pick(live.filter((L) => ymOf(L.end) === m.key))] }))] };
  };
  // Interest income: last 12 months (accrued) + next 6 (projected).
  const back = monthAxis({ to: now.toISOString().slice(0, 10) });
  const ahead = forwardAxis(7).slice(1);
  const top = [...live].sort((a, b) => b.balance - a.balance).slice(0, 10);
  // Client 27-10-2026: one tab per interest type (Serviced, Retained), each showing the
  // interest amount and the number of facilities earning it - accrued past months on the
  // whole book, projected future months on the live book.
  const interestView = (type) => {
    const past = book.filter((L) => L.interestType === type);
    const future = live.filter((L) => L.interestType === type);
    const months = [
      ...back.map((m) => past.map((L) => interestInMonth(L, m.start, { projectFuture: false }))),
      ...ahead.map((m) => future.map((L) => interestInMonth(L, m.start))),
    ];
    return { key: type.toLowerCase(), label: type, type: 'line', format: 'currency', data: {
      labels: [...back.map((m) => m.label), ...ahead.map((m) => m.label)],
      series: [
        { name: `${type} Interest`, values: months.map((xs) => r2(xs.reduce((a, x) => a + x, 0))), area: true },
        { name: 'Facilities', values: months.map((xs) => xs.filter((x) => x > 0).length), axis: 'right', format: 'number' },
      ],
    } };
  };
  const servicedLive = live.filter((L) => L.interestType === 'Serviced');
  const servicedMonth = sum(servicedLive, (L) => interestInMonth(L, m0));
  // Client 26-10-2026: redemptions + approved extensions per month (book loans only).
  const byId = new Map(book.map((L) => [L.id, L]));
  const exts = (await extensionRows()).filter((x) => byId.has(x.loan_id) && x.extended_on)
    .map((x) => ({ date: x.extended_on, amount: n(x.amount) || byId.get(x.loan_id).principal }));
  const redAxis = monthAxis(f);
  const redExt = (field) => {
    const pick = (rows, amt) => (field === 'count' ? rows.length : r2(sum(rows, amt)));
    return {
      seriesNames: ['Redemptions', 'Extensions'],
      keys: redAxis.map((m) => m.key),
      groups: redAxis.map((m) => ({ label: m.label, values: [
        pick(book.filter((L) => L.redeemedOn && ymOf(L.redeemedOn) === m.key), (L) => L.redeemedPrincipal),
        pick(exts.filter((x) => ymOf(x.date) === m.key), (x) => x.amount),
      ] })),
    };
  };

  return {
    kpis: [
      tile('Live Facilities', live.length, `${book.length} on record`, 'bi-window-stack'),
      tile('Live Book', sum(live, bal), 'Outstanding', 'bi-cash-stack', { format: 'currency', tone: 'positive' }),
      tile('Interest This Month', monthInterest, `${r2(wavg)}% pm avg rate`, 'bi-graph-up', { format: 'currency' }),
      // Client 26-10-2026: the part borrowers pay in cash this month (retained is deducted up front).
      tile('Serviced Interest This Month', servicedMonth, `${servicedLive.length} serviced facilit${servicedLive.length === 1 ? 'y' : 'ies'}`, 'bi-cash-coin', { format: 'currency' }),
      tile('Exit Fees Expected', sum(live, (L) => L.exitExpected), 'Live book', 'bi-box-arrow-right', { format: 'currency' }),
      tile('Maturing ≤ 90 Days', in90.length, gbpShort(sum(in90, bal)), 'bi-calendar-event', { tone: in90.length ? 'warning' : 'default' }),
      tile('Bad Debt', sum(bad, (L) => L.principal), `${bad.length} facilities`, 'bi-exclamation-triangle', { format: 'currency', tone: 'danger' }),
    ],
    charts: [
      chart('maturity', 'Loans Coming Back — Next 12 Months', [
        { ...COUNT, type: 'bar', format: 'number', data: ladder('count') },
        { ...VALUE, type: 'bar', format: 'currency', data: ladder('value') },
      ], { span: 'full', subtitle: 'Live facilities by maturity month' }),
      chart('interest', 'Interest Income per Month', [interestView('Serviced'), interestView('Retained')],
        { span: 'full', subtitle: 'Interest amount and number of facilities · last 12 months earned, next 6 months projected on the live book · retained interest is shown as it accrues each month' }),
      chart('redemptions', 'Redemptions & Extensions per Month', [
        { ...COUNT, type: 'bar', format: 'number', data: redExt('count') },
        { ...VALUE, type: 'bar', format: 'currency', data: redExt('value') },
      ], { span: 'full', subtitle: 'Completed redemptions (principal repaid) and approved extensions (amount extended) by month' }),
      chart('product', 'Live Book by Product', donutViews(groupBy(live, (L) => L.product), bal), { drill: 'product' }),
      chart('status', 'Facilities by Status', donutViews(groupBy(book, (L) => L.status || 'Unknown'), (L) => L.principal), { drill: 'status' }),
      chart('top', 'Top 10 Facilities by Balance', { type: 'barlist', format: 'currency', data: { items: top.map((L) => ({ label: `${L.ref} · ${L.customer}`, value: r2(L.balance), display: gbpShort(L.balance) })) } }),
      chart('bdm', 'Live Book by BDM', barlistViews(groupBy(live, (L) => L.bdm), bal), { drill: 'bdm' }),
      brokerChart(book, (L) => (['Redeemed', 'Recovered'].includes(L.status) ? 'Completed' : L.live ? 'Left' : ['Bad Debt', 'Written Off'].includes(L.status) ? 'Declined' : null),
        (L) => L.totalGross, 'Completed = redeemed (matured & paid) · Left = live loans · Declined = bad debt / written off'),
    ],
    detail: facilityDetail(book, m0),
  };
}

/* ================================================================== */
/*  INCOME & CASHFLOW                                                  */
/* ================================================================== */
async function financeReport(f) {
  const book = await loanBook({ ...f, status: null });
  const live = book.filter((L) => L.live);
  const now = today();
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const axis = monthAxis(f);
  const fwd = forwardAxis(12);
  const sameMonth = (d, m) => ymOf(d) === m.key;
  const pastOrNow = (m) => m.start <= m0;
  const income = axis.map((m) => ({
    interest: r2(sum(book, (L) => interestInMonth(L, m.start, { projectFuture: false }))),
    fees: r2(sum(book.filter((L) => sameMonth(L.start, m)), (L) => L.arrangement) + sum(book, (L) => sum(L.otherFees.filter((x) => sameMonth(x.date, m)), (x) => x.amount))),
    exit: r2(sum(book.filter((L) => L.redeemedOn && sameMonth(L.redeemedOn, m)), (L) => L.exitActual)),
  }));
  const cash = axis.map((m) => ({
    out: r2(sum(book.filter((L) => sameMonth(L.start, m)), (L) => L.day1Net) + sum(book, (L) => sum(L.tranches.filter((t) => sameMonth(t.date, m)), (t) => t.net))),
    in: r2(sum(book, (L) => sum(L.payments.filter((p) => sameMonth(p.date, m)), (p) => p.amount))),
  }));
  const forecast = fwd.map((m, i) => {
    const due = live.filter((L) => (i === 0 ? (L.end && L.end < new Date(Date.UTC(m.start.getUTCFullYear(), m.start.getUTCMonth() + 1, 1))) : sameMonth(L.end, m)));
    return {
      redemptions: r2(sum(due, (L) => L.drawnGross)), exit: r2(sum(due, (L) => L.exitExpected)),
      interest: r2(sum(live, (L) => interestInMonth(L, m.start))),
      drawdowns: r2(sum(live, (L) => sum(L.planned.filter((t) => t.date && sameMonth(t.date, m) && t.date >= now), (t) => t.net))),
    };
  });
  const rangeIdx = axis.map((m, i) => (pastOrNow(m) ? i : -1)).filter((i) => i >= 0);
  const tot = (arr, k) => sum(rangeIdx.map((i) => arr[i][k]));
  const monthInterest = sum(live, (L) => interestInMonth(L, m0));
  let running = 0;
  const net = axis.map((_, i) => { running += cash[i].in - cash[i].out; return r2(running); });
  const incomeTotals = [
    { label: 'Interest', value: r2(tot(income, 'interest')) }, { label: 'Arrangement & other fees', value: r2(tot(income, 'fees')) },
    { label: 'Exit fees', value: r2(tot(income, 'exit')) },
  ];

  return {
    kpis: [
      tile('Interest This Month', monthInterest, `${live.length} live facilities`, 'bi-graph-up', { format: 'currency', tone: 'positive' }),
      tile('Income In Period', tot(income, 'interest') + tot(income, 'fees') + tot(income, 'exit'), 'Interest + fees', 'bi-cash-coin', { format: 'currency' }),
      tile('Exit Fees Expected', sum(live, (L) => L.exitExpected), 'Live book', 'bi-box-arrow-right', { format: 'currency' }),
      tile('Due Back Next 12M', sum(forecast, (x) => x.redemptions), 'Redemptions', 'bi-arrow-return-left', { format: 'currency' }),
      tile('Money Out', tot(cash, 'out'), 'Completions + drawdowns', 'bi-box-arrow-up', { format: 'currency', tone: 'warning' }),
      tile('Money In', tot(cash, 'in'), 'Payments received', 'bi-box-arrow-in-down', { format: 'currency', tone: 'positive' }),
    ],
    charts: [
      chart('income', 'Income per Month', { type: 'bar', format: 'currency', data: {
        seriesNames: ['Interest', 'Arrangement & other fees', 'Exit fees'],
        groups: axis.map((m, i) => ({ label: m.label, values: [income[i].interest, income[i].fees, income[i].exit] })),
      } }, { span: 'full' }),
      chart('mix', 'Income Mix', { type: 'donut', format: 'currency', data: { items: incomeTotals } }),
      chart('cashflow', 'Money Out vs In', [
        { key: 'month', label: 'Per month', type: 'bar', format: 'currency', data: { seriesNames: ['Out', 'In'], groups: axis.map((m, i) => ({ label: m.label, values: [cash[i].out, cash[i].in] })) } },
        { key: 'cum', label: 'Running net', type: 'line', format: 'currency', data: { labels: axis.map((m) => m.label), series: [{ name: 'Net cash (in - out)', values: net.map((v) => Math.max(0, v)) }, { name: 'Net cash out', values: net.map((v) => Math.max(0, -v)) }] } },
      ]),
      chart('forecast', 'Next 12 Months — Expected', [
        { key: 'cash', label: 'Cash', type: 'bar', format: 'currency', data: { seriesNames: ['Redemptions due', 'Drawdowns out'], groups: fwd.map((m, i) => ({ label: m.label, values: [forecast[i].redemptions, forecast[i].drawdowns] })) } },
        { key: 'income', label: 'Income', type: 'line', format: 'currency', data: { labels: fwd.map((m) => m.label), series: [{ name: 'Interest', values: forecast.map((x) => x.interest), area: true }, { name: 'Exit fees', values: forecast.map((x) => x.exit), area: true }] } },
      ], { span: 'full' }),
    ],
    detail: facilityDetail(book, m0),
  };
}

module.exports = {
  enquiryReport, applicationReport, underwritingReport, portfolioReport, financeReport, summaryReport,
  _internal: { monthAxis, band, modelLoan, interestInMonth, SIZE_BANDS, uwStage, enqOutcome, declineRows, businessMixChart, bookMovementChart },
};
