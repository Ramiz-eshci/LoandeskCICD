'use strict';

/**
 * Reports service — the Showcase report.
 *
 * Three parts, all read-only and permission-aware:
 *   1. HIGH LEVEL  — headline KPIs + per-module tiles/charts (live snapshot).
 *   2. DETAIL      — filterable row-level tables (enquiries / cases / facilities).
 *   3. EXPORT      — the whole report as PDF, or one section as CSV.
 *
 * Modules covered: Enquiry (top of funnel), Underwriting (decision engine),
 * Portfolio (live book). A module section is OMITTED unless the caller holds the
 * module's `view` permission (reusing dashboard.canView).
 *
 * A03: every value is bound (named params via db.queryNamed). No identifier
 * ever comes from the request unescaped. Each block is wrapped in safe().
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { buildWorkbook } = require('../utils/xlsx.util');
const db = require('../config/database');
const { LATEST_GROSS_APPLY, LOAN_AMOUNT_SQL, LOAN_BASIS_SQL } = require('../utils/loanAmount');
const { canView } = require('./dashboard.service');
const { roleHasPermission } = require('../middlewares/rbac');
const { own } = require('../utils/own');

/**
 * Per-report permissions (client 26-10-2026): each report is its own Roles-matrix
 * row (REPORTS.<X> view) and has an "All Data" row (REPORTS.<X>_ALL view).
 */
const REPORT_PERM = {
  enquiry: 'REPORTS.ENQUIRY',
  application: 'REPORTS.APPLICATION',
  underwriting: 'REPORTS.UNDERWRITING',
  portfolio: 'REPORTS.PORTFOLIO',
  finance: 'REPORTS.FINANCE',
  summary: 'REPORTS.SUMMARY',
};

/**
 * Own-data scope: a user without the report's "All Data" row (e.g. a BDM) only
 * ever sees their OWN rows in it — enquiries/applications assigned to them (BDM /
 * owner), cases they underwrite. Returns the user_id to force as the `bdm`
 * filter, or null (admin, or holds REPORTS.<X>_ALL). Reports only — the list
 * screens keep their own ALL_* permissions. Forcing it server-side also means a
 * scoped user cannot widen the view by passing ?bdm=<someone else>.
 */
async function scopeBdm(req, section) {
  const u = (req && req.userData) || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return null;
  const perm = REPORT_PERM[section];
  if (perm) {
    try { if (await roleHasPermission(u.roleId, `${perm}_ALL`, 'view')) return null; } catch (_) { /* fall through to scoped */ }
  }
  return u.userId || 0;
}

const n = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const r0 = (v) => (Array.isArray(v) && v[0]) || {};

async function safe(label, fn, fallback) {
  try { return await fn(); } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[reports] ${label} failed:`, e && e.message);
    return fallback;
  }
}

/** Which modules may this caller see? */
async function visibility(req) {
  const [enquiry, underwriting, portfolio] = await Promise.all([
    canView(req, REPORT_PERM.enquiry),
    canView(req, REPORT_PERM.underwriting),
    canView(req, REPORT_PERM.portfolio),
  ]);
  return { enquiry, underwriting, portfolio };
}

/** Parse + sanitise the query filters. Everything is bound later. */
function parseFilters(q) {
  q = q || {};
  const d = (v) => {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const s = (v, max) => {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t ? t.slice(0, max) : null;
  };
  const bi = (v) => { const num = parseInt(v, 10); return Number.isFinite(num) && num > 0 ? num : null; };
  return {
    from: d(q.from),
    to: d(q.to),
    status: s(q.status, 60),
    search: s(q.search, 80),
    bdm: bi(q.bdm),
  };
}

function likeParam(search) {
  return search ? `%${search.replace(/[%_\[]/g, (m) => `[${m}]`)}%` : null;
}

const CUSTOMER = (a) =>
  `COALESCE(NULLIF(${a}.company_name, ''), NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(${a}.first_name,''),' ',COALESCE(${a}.last_name,'')))), ''), ${a}.email, 'Customer')`;
const USERNAME = (u) =>
  `NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(${u}.first_name,''),' ',COALESCE(${u}.last_name,'')))), '')`;

const lastSixMonths = () => {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 5; i >= 0; i -= 1) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push({ key: `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`, label: m.toLocaleString('en-GB', { month: 'short' }) });
  }
  return out;
};
const alignMonths = (rows, axis, field = 'total') => {
  const by = new Map((rows || []).map((x) => [String(x.ym), n(x[field])]));
  return axis.map((m) => by.get(m.key) || 0);
};

/* ================================================================== */
/*  HIGH-LEVEL (snapshot, unfiltered)                                  */
/* ================================================================== */
async function enquirySection(req, out, head) {
  const axis = lastSixMonths();
  const totals = await safe('enquiry totals', () => db.query(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN e.created_at >= DATEADD(day,-30,SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS last30,
       SUM(CASE WHEN s.is_terminal = 0 THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN s.is_terminal = 0 THEN ISNULL(e.amount_requested,0) ELSE 0 END) AS open_value,
       SUM(CASE WHEN s.code = 'CONVERTED' THEN 1 ELSE 0 END) AS converted
     FROM enquiries e LEFT JOIN enquiry_statuses s ON s.enquiry_status_id = e.enquiry_status_id
     WHERE e.flag_deleted = 0`), []);
  const t = r0(totals); const total = n(t.total); const converted = n(t.converted);
  const pipeline = await safe('enquiry pipeline', async () => (await db.query(
    `SELECT s.code, s.name, s.sort_order, COUNT(e.enquiry_id) AS total
       FROM enquiry_statuses s
       LEFT JOIN enquiries e ON e.enquiry_status_id = s.enquiry_status_id AND e.flag_deleted = 0
      WHERE s.flag_deleted = 0 GROUP BY s.code, s.name, s.sort_order ORDER BY s.sort_order`))
    .map((x) => ({ code: x.code, label: x.name, value: n(x.total) })), []);
  const trend = await safe('enquiry trend', () => db.query(
    `SELECT FORMAT(e.created_at,'yyyy-MM') AS ym, COUNT(*) AS total FROM enquiries e
      WHERE e.flag_deleted = 0 AND e.created_at >= DATEADD(month,-6,SYSUTCDATETIME())
      GROUP BY FORMAT(e.created_at,'yyyy-MM')`), []);
  out.enquiry = {
    tiles: [
      { label: 'Total Enquiries', value: total, caption: 'All time', icon: 'bi-file-earmark-text' },
      { label: 'New (30 days)', value: n(t.last30), caption: 'Last 30 days', icon: 'bi-plus-circle' },
      { label: 'Open Enquiries', value: n(t.open_count), caption: 'In progress', icon: 'bi-inbox' },
      { label: 'Open Value', value: n(t.open_value), caption: 'Requested amount', icon: 'bi-currency-pound', format: 'currency' },
    ],
    pipeline,
    trend: { labels: axis.map((m) => m.label), values: alignMonths(trend, axis) },
    conversion: { total, converted, rate_pct: total ? Math.round((converted / total) * 1000) / 10 : 0 },
    statuses: pipeline.map((p) => p.label),
  };
  head.push({ key: 'pipeline_value', label: 'Open Enquiry Value', value: n(t.open_value), caption: 'Live demand', icon: 'bi-currency-pound', format: 'currency', tone: 'default' });
}

async function underwritingSection(req, out, head) {
  const totals = await safe('uw totals', () => db.query(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN uc.status NOT IN ('Rejected','Closed','In Portfolio') THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN uc.status = 'In Portfolio' THEN 1 ELSE 0 END) AS in_portfolio,
       SUM(CASE WHEN uc.status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN uc.sla_due_date IS NOT NULL AND uc.sla_due_date < CAST(SYSUTCDATETIME() AS DATE)
                 AND uc.status NOT IN ('Rejected','Closed','In Portfolio') THEN 1 ELSE 0 END) AS overdue
     FROM underwriting_cases uc WHERE uc.flag_deleted = 0`), []);
  const t = r0(totals); const decided = n(t.in_portfolio) + n(t.rejected);
  const byStatus = await safe('uw by status', async () => (await db.query(
    `SELECT uc.status AS label, COUNT(*) AS total FROM underwriting_cases uc
      WHERE uc.flag_deleted = 0 GROUP BY uc.status ORDER BY COUNT(*) DESC`))
    .map((x) => ({ label: x.label || 'Unknown', value: n(x.total) })), []);
  const byStep = await safe('uw by step', async () => (await db.query(
    `SELECT uc.current_step AS step, COUNT(*) AS total FROM underwriting_cases uc
      WHERE uc.flag_deleted = 0 AND uc.status NOT IN ('Rejected','Closed','In Portfolio')
      GROUP BY uc.current_step ORDER BY uc.current_step`))
    .map((x) => ({ step: n(x.step), value: n(x.total) })), []);
  out.underwriting = {
    tiles: [
      { label: 'Open Cases', value: n(t.open_count), caption: 'Active casebook', icon: 'bi-clipboard-check' },
      { label: 'Approved to Portfolio', value: n(t.in_portfolio), caption: 'Lifetime', icon: 'bi-check2-circle' },
      { label: 'Rejected', value: n(t.rejected), caption: 'Lifetime', icon: 'bi-x-circle' },
      { label: 'SLA Overdue', value: n(t.overdue), caption: 'Past due date', icon: 'bi-alarm' },
    ],
    by_status: byStatus, by_step: byStep,
    approval: { decided, approved: n(t.in_portfolio), rate_pct: decided ? Math.round((n(t.in_portfolio) / decided) * 1000) / 10 : 0 },
    statuses: byStatus.map((s) => s.label),
  };
  head.push({ key: 'uw_open', label: 'Underwriting Cases', value: n(t.open_count), caption: 'Open for decision', icon: 'bi-clipboard-check', tone: 'warning' });
}

async function portfolioSection(req, out, head) {
  const axis = lastSixMonths();
  const byStatus = await safe('loans by status', async () => (await db.query(
    `SELECT l.status AS label, COUNT(*) AS total, SUM(ISNULL(l.principal,0)) AS principal
       FROM loans l WHERE l.flag_deleted = 0 GROUP BY l.status`))
    .map((x) => ({ label: x.label || 'Unknown', value: n(x.total), principal: n(x.principal) })), []);
  const live = await safe('live book', () => db.query(
    `SELECT COUNT(*) AS live_count, SUM(ISNULL(l.principal,0)) AS book_value,
       CASE WHEN SUM(ISNULL(l.principal,0)) > 0 THEN SUM(ISNULL(l.principal,0)*ISNULL(l.rate_pct,0))/SUM(ISNULL(l.principal,0)) ELSE 0 END AS wavg_rate
     FROM loans l WHERE l.flag_deleted = 0 AND l.status = 'Active'`), []);
  const lv = r0(live);
  const bad = await safe('bad debt', () => db.query(
    `SELECT SUM(CASE WHEN l.status IN ('Bad Debt','Written Off') THEN 1 ELSE 0 END) AS bad_count,
       SUM(CASE WHEN l.status = 'Bad Debt' THEN ISNULL(l.principal,0) ELSE 0 END) AS bad_exposure,
       SUM(CASE WHEN l.status = 'Written Off' THEN ISNULL(l.write_off_amount,0) ELSE 0 END) AS written_off
     FROM loans l WHERE l.flag_deleted = 0`), []);
  const bd = r0(bad);
  const mat = await safe('maturity ladder', () => db.query(
    `SELECT FORMAT(l.maturity_date,'yyyy-MM') AS ym, COUNT(*) AS total, SUM(ISNULL(l.principal,0)) AS principal
       FROM loans l WHERE l.flag_deleted = 0 AND l.status = 'Active' AND l.maturity_date IS NOT NULL
        AND l.maturity_date >= CAST(SYSUTCDATETIME() AS DATE)
        AND l.maturity_date < DATEADD(month,6,CAST(SYSUTCDATETIME() AS DATE))
      GROUP BY FORMAT(l.maturity_date,'yyyy-MM')`), []);
  out.portfolio = {
    tiles: [
      { label: 'Live Facilities', value: n(lv.live_count), caption: 'Active book', icon: 'bi-window-stack' },
      { label: 'Book Value', value: n(lv.book_value), caption: 'Principal on book', icon: 'bi-cash-stack', format: 'currency' },
      { label: 'Weighted Avg Rate', value: Math.round(n(lv.wavg_rate) * 100) / 100, caption: 'By principal', icon: 'bi-percent', format: 'percent' },
      { label: 'Bad-Debt Exposure', value: n(bd.bad_exposure), caption: `${n(bd.bad_count)} impaired`, icon: 'bi-exclamation-triangle', format: 'currency', tone: 'danger' },
    ],
    by_status: byStatus,
    maturities: { labels: axis.map((m) => m.label), counts: alignMonths(mat, axis), principal: alignMonths(mat, axis, 'principal') },
    written_off: n(bd.written_off),
    statuses: byStatus.map((s) => s.label),
  };
  head.push({ key: 'book_value', label: 'Live Book Value', value: n(lv.book_value), caption: 'On the book', icon: 'bi-cash-stack', format: 'currency', tone: 'positive' });
}

/* ================================================================== */
/*  DETAIL (filtered row-level)                                        */
/* ================================================================== */
const DETAIL = {
  enquiry: {
    module: 'REPORTS.ENQUIRY',
    title: 'Enquiries',
    columns: [
      { key: 'ref', header: 'Reference' },
      { key: 'customer', header: 'Applicant' },
      { key: 'status', header: 'Status' },
      // Client 15-10-2026: Loan Amount + its basis (Net / Gross) - same figure as the enquiry list.
      { key: 'basis', header: 'Basis' },
      { key: 'amount', header: 'Loan Amount', type: 'currency' },
      { key: 'assigned', header: 'Assigned To' },
      { key: 'created_at', header: 'Created', type: 'date' },
    ],
    async query(f, cap) {
      return db.queryNamed(
        `SELECT TOP (@cap) e.enquiry_ref AS ref, ISNULL(e.applicant_name,'—') AS customer,
                ISNULL(s.name,'—') AS status, ISNULL(${LOAN_AMOUNT_SQL},0) AS amount,
                ${LOAN_BASIS_SQL} AS basis,
                ISNULL(u.full_name,'—') AS assigned, e.created_at
           FROM enquiries e
           LEFT JOIN enquiry_statuses s ON s.enquiry_status_id = e.enquiry_status_id
           LEFT JOIN users u ON u.user_id = e.assigned_to
           ${LATEST_GROSS_APPLY}
          WHERE e.flag_deleted = 0
            AND (@from IS NULL OR e.created_at >= @from)
            AND (@to IS NULL OR e.created_at < DATEADD(day,1,@to))
            AND (@status IS NULL OR s.name = @status)
            AND (@bdm IS NULL OR e.assigned_to = @bdm)
            AND (@search IS NULL OR e.enquiry_ref LIKE @search OR e.applicant_name LIKE @search)
          ORDER BY e.created_at DESC`,
        { cap, from: f.from, to: f.to, status: f.status, bdm: f.bdm, search: likeParam(f.search) });
    },
  },
  underwriting: {
    module: 'REPORTS.UNDERWRITING',
    title: 'Underwriting Cases',
    columns: [
      { key: 'ref', header: 'Application' },
      { key: 'customer', header: 'Customer' },
      { key: 'status', header: 'Status' },
      { key: 'step', header: 'Step', type: 'number' },
      { key: 'underwriter', header: 'Underwriter' },
      { key: 'created_at', header: 'Opened', type: 'date' },
      { key: 'sla_due_date', header: 'SLA Due', type: 'date' },
    ],
    async query(f, cap) {
      return db.queryNamed(
        `SELECT TOP (@cap) a.application_ref AS ref, ISNULL(${CUSTOMER('ap')},'—') AS customer,
                uc.status, uc.current_step AS step, ISNULL(u.full_name,'—') AS underwriter,
                uc.created_at, uc.sla_due_date
           FROM underwriting_cases uc
           JOIN applications a ON a.application_id = uc.application_id AND a.flag_deleted = 0
           LEFT JOIN users u ON u.user_id = uc.underwriter_id
           LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
           LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
          WHERE uc.flag_deleted = 0
            AND (@from IS NULL OR uc.created_at >= @from)
            AND (@to IS NULL OR uc.created_at < DATEADD(day,1,@to))
            AND (@status IS NULL OR uc.status = @status)
            AND (@bdm IS NULL OR uc.underwriter_id = @bdm)
            AND (@search IS NULL OR a.application_ref LIKE @search)
          ORDER BY uc.created_at DESC`,
        { cap, from: f.from, to: f.to, status: f.status, bdm: f.bdm, search: likeParam(f.search) });
    },
  },
  portfolio: {
    module: 'REPORTS.PORTFOLIO',
    title: 'Facilities',
    columns: [
      { key: 'facility', header: 'Facility' },
      { key: 'customer', header: 'Customer' },
      { key: 'principal', header: 'Principal', type: 'currency' },
      { key: 'rate', header: 'Rate %', type: 'number' },
      { key: 'status', header: 'Status' },
      { key: 'start_date', header: 'Start', type: 'date' },
      { key: 'maturity_date', header: 'Maturity', type: 'date' },
    ],
    async query(f, cap) {
      return db.queryNamed(
        `SELECT TOP (@cap) l.loan_number AS facility, ISNULL(${CUSTOMER('ap')},'—') AS customer,
                ISNULL(l.principal,0) AS principal, ISNULL(l.rate_pct,0) AS rate, l.status,
                l.start_date, l.maturity_date
           FROM loans l
           JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
           LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
           LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
          WHERE l.flag_deleted = 0
            AND (@from IS NULL OR l.start_date >= @from)
            AND (@to IS NULL OR l.start_date < DATEADD(day,1,@to))
            AND (@status IS NULL OR l.status = @status)
            AND (@bdm IS NULL OR a.assigned_to = @bdm)
            AND (@search IS NULL OR l.loan_number LIKE @search)
          ORDER BY l.maturity_date ASC`,
        { cap, from: f.from, to: f.to, status: f.status, bdm: f.bdm, search: likeParam(f.search) });
    },
  },
};

DETAIL.application = {
  module: 'REPORTS.APPLICATION',
  title: 'Applications',
  columns: [
    { key: 'ref', header: 'Reference' },
    { key: 'customer', header: 'Applicant' },
    { key: 'product', header: 'Product' },
    { key: 'amount', header: 'Amount', type: 'currency' },
    { key: 'status', header: 'Status' },
    { key: 'created_at', header: 'Created', type: 'date' },
  ],
  async query(f, cap) {
    return db.queryNamed(
      `SELECT TOP (@cap) a.application_ref AS ref, ISNULL(${CUSTOMER('ap')},'—') AS customer,
              ISNULL(p.name,'—') AS product, ISNULL(a.amount_requested,0) AS amount,
              ISNULL(st.name,'—') AS status, a.created_at
         FROM applications a
         LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
         LEFT JOIN products p ON p.product_id = a.product_id
         LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
         LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
        WHERE a.flag_deleted = 0
          AND (@from IS NULL OR a.created_at >= @from)
          AND (@to IS NULL OR a.created_at < DATEADD(day,1,@to))
          AND (@status IS NULL OR st.name = @status)
          AND (@bdm IS NULL OR a.assigned_to = @bdm)
          AND (@search IS NULL OR a.application_ref LIKE @search)
        ORDER BY a.created_at DESC`,
      { cap, from: f.from, to: f.to, status: f.status, bdm: f.bdm, search: likeParam(f.search) });
  },
};

/** Filtered rows for one section (used by the page and CSV export). */
async function detail(req, section, filters, cap = 200) {
  const spec = own(DETAIL, section);
  if (!spec) { const e = new Error('Unknown report section'); e.status = 400; throw e; }
  if (!(await canView(req, spec.module))) { const e = new Error('Not permitted'); e.status = 403; throw e; }
  const f = parseFilters(filters);
  const sid = await scopeBdm(req, section);
  if (sid) f.bdm = sid;
  const rows = await safe(`detail ${section}`, () => spec.query(f, Math.min(Number(cap) || 200, 5000)), []);
  return { section, title: spec.title, columns: spec.columns, rows };
}

/* ================================================================== */
/*  SHOWCASE (high level + initial detail)                            */
/* ================================================================== */
async function showcase(req, filters) {
  const vis = await visibility(req);
  const sections = {};
  const headline = [];
  const f = parseFilters(filters);

  if (vis.enquiry) await enquirySection(req, sections, headline);
  if (vis.underwriting) await underwritingSection(req, sections, headline);
  if (vis.portfolio) await portfolioSection(req, sections, headline);

  // Initial detail rows (filtered when the page passes filters; capped for the page).
  const detailRows = {};
  for (const s of Object.keys(DETAIL)) {
    if (vis[s]) {
      const sid = await scopeBdm(req, s);
      const fs = sid ? { ...f, bdm: sid } : f;
      detailRows[s] = await safe(`detail ${s}`, () => DETAIL[s].query(fs, 200), []);
    }
  }

  const u = (req && req.userData) || {};
  return {
    headline,
    ...sections,
    detail: {
      columns: Object.fromEntries(Object.keys(DETAIL).map((s) => [s, DETAIL[s].columns])),
      rows: detailRows,
    },
    context: {
      title: 'Lending Performance Showcase',
      subtitle: 'Enquiry · Underwriting · Portfolio',
      filters: f,
      user_id: u.userId || null,
      role_id: u.roleId || null,
      generated_at: new Date().toISOString(),
    },
  };
}

/* ================================================================== */
/*  EXPORT                                                             */
/* ================================================================== */
const gbp = (v) => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-GB') : '');
function fmtCell(col, v) {
  if (col.type === 'currency') return gbp(v);
  if (col.type === 'date') return fmtDate(v);
  if (v === null || v === undefined) return '';
  return String(v);
}
/**
 * CSV / formula injection guard (pen-test 24-10-2026, OWASP): a cell that Excel would run as
 * a formula (= + @ tab CR, or "-" that is not just a negative number / amount) gets a leading
 * apostrophe so it opens as plain text. Normal negatives like -12.5, -£1,234.00 or -5% stay as they are.
 */
const NEGATIVE_AMOUNT = /^-[£$€]?[\d,]+(\.\d+)?%?$/;
function neutraliseFormula(t) {
  if (/^[=+@\t\r]/.test(t) || (t.startsWith('-') && !NEGATIVE_AMOUNT.test(t))) return `'${t}`;
  return t;
}
function csvCell(s) {
  const t = neutraliseFormula(s === null || s === undefined ? '' : String(s));
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** One section -> CSV buffer. */
async function exportCsv(req, section, filters) {
  const spec = own(DETAIL, section);
  if (!spec) { const e = new Error('Unknown report section'); e.status = 400; throw e; }
  if (!(await canView(req, spec.module))) { const e = new Error('Not permitted'); e.status = 403; throw e; }
  const f = parseFilters(filters);
  const sid = await scopeBdm(req, section);
  if (sid) f.bdm = sid;
  const rows = await spec.query(f, 5000);
  const header = spec.columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) => spec.columns.map((c) => csvCell(fmtCell(c, row[c.key]))).join(',')).join('\n');
  return { filename: `${section}-report.csv`, buffer: Buffer.from('﻿' + header + '\n' + body, 'utf8') };
}

/* --- Brand header (Loan7esk) --- */
const BRAND_LOGO = path.join(__dirname, '..', 'assets', 'brand', 'loandesk-logo.png');
const HAS_LOGO = (() => { try { return fs.existsSync(BRAND_LOGO); } catch (_) { return false; } })();
const LOGO_RATIO = 2773 / 631; // loandesk-logo.png dimensions
const BAND_H = 72;
const PDF_NAVY = '#0f2244';
const PDF_GOLD = '#eaab00';

/** Draw the branded navy band with the logo + gold rule on the current page. */
function brandHeader(doc) {
  const W = doc.page.width;
  doc.save();
  doc.rect(0, 0, W, BAND_H).fill(PDF_NAVY);
  doc.rect(0, BAND_H, W, 3).fill(PDF_GOLD);
  const lh = 30;
  const lw = lh * LOGO_RATIO;
  if (HAS_LOGO) {
    try { doc.image(BRAND_LOGO, 40, (BAND_H - lh) / 2, { height: lh, width: lw }); }
    catch (_) { doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text('Loan7esk', 40, 24); }
  } else {
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text('Loan7esk', 40, 24);
  }
  doc.fillColor('#c9d6e8').font('Helvetica').fontSize(8.5)
    .text('LENDING PERFORMANCE REPORT', W - 260, 30, { width: 220, align: 'right' });
  doc.restore();
  doc.fillColor('#000000');
}

/** Whole report -> PDF buffer (headline + per-module summary + detail tables). */
async function exportPdf(req, filters) {
  const data = await showcase(req, filters);
  const f = data.context.filters;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 96, left: 40, right: 40, bottom: 44 }, bufferPages: true });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const NAVY = PDF_NAVY; const GOLD = PDF_GOLD; const MUTE = '#64748b';
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // Brand every page.
  brandHeader(doc);
  doc.on('pageAdded', () => brandHeader(doc));
  doc.x = left; doc.y = 90;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(data.context.title);
  doc.moveDown(0.2);
  doc.fillColor(MUTE).font('Helvetica').fontSize(11).text(data.context.subtitle);
  doc.fontSize(9).text(`Generated ${new Date(data.context.generated_at).toLocaleString('en-GB')}`);
  const filterLine = [f.from ? `From ${f.from}` : null, f.to ? `To ${f.to}` : null, f.status ? `Status ${f.status}` : null, f.search ? `Search "${f.search}"` : null].filter(Boolean).join('  ·  ');
  doc.text(filterLine ? `Filters: ${filterLine}` : 'Filters: none (all records)');
  doc.moveTo(left, doc.y + 6).lineTo(left + pageW, doc.y + 6).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1);

  // Headline KPIs
  if (data.headline && data.headline.length) {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('Headline');
    doc.moveDown(0.3);
    data.headline.forEach((t) => {
      const val = t.format === 'currency' ? gbp(t.value) : t.format === 'percent' ? `${t.value}%` : Number(t.value).toLocaleString('en-GB');
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(`${val}`, { continued: true });
      doc.font('Helvetica').fontSize(10).fillColor(MUTE).text(`   ${t.label} — ${t.caption}`);
    });
    doc.moveDown(0.8);
  }

  const drawTable = (title, columns, rows, limit) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.x = left;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(title);
    doc.moveDown(0.3);
    const shown = rows.slice(0, limit);
    if (!shown.length) { doc.x = left; doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTE).text('No records for the current filters.'); doc.moveDown(0.8); return; }
    const colW = pageW / columns.length;
    let y = doc.y;
    // header
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
    doc.rect(left, y, pageW, 16).fill(NAVY);
    columns.forEach((c, i) => doc.fillColor('#fff').text(c.header.toUpperCase(), left + i * colW + 4, y + 4, { width: colW - 8, ellipsis: true }));
    y += 16;
    doc.font('Helvetica').fontSize(8);
    shown.forEach((row, ri) => {
      if (y > doc.page.height - 40) { doc.addPage(); y = doc.page.margins.top; }
      if (ri % 2 === 0) { doc.rect(left, y, pageW, 14).fill('#f1f5f9'); }
      columns.forEach((c, i) => {
        const align = (c.type === 'currency' || c.type === 'number') ? 'right' : 'left';
        doc.fillColor('#0f172a').text(fmtCell(c, row[c.key]), left + i * colW + 4, y + 3, { width: colW - 8, ellipsis: true, align });
      });
      y += 14;
    });
    doc.y = y; doc.x = left;
    if (rows.length > limit) { doc.moveDown(0.2); doc.x = left; doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTE).text(`Showing first ${limit} of ${rows.length} records. Use CSV export for the full set.`); }
    doc.moveDown(1);
    doc.x = left;
    doc.fillColor('#0f172a');
  };

  const titles = { enquiry: 'Enquiry — Records', underwriting: 'Underwriting — Records', portfolio: 'Portfolio — Records' };
  for (const s of ['enquiry', 'underwriting', 'portfolio']) {
    if (data.detail.rows[s]) drawTable(titles[s], data.detail.columns[s], data.detail.rows[s], 30);
  }

  doc.end();
  return { filename: 'lending-performance-report.pdf', buffer: await done };
}

/* ================================================================== */
/*  PER-MODULE REPORTS (KPIs + multiple chart types)                  */
/* ================================================================== */

const analytics = require('./reports.analytics.service');

const TITLE_OF = {
  enquiry: 'Enquiry Report',
  application: 'Application Report',
  underwriting: 'Underwriting Report',
  portfolio: 'Portfolio Report',
  finance: 'Income & Cashflow Report',
  summary: 'Overall Summary',
};
/** Fallback detail table for each report (finance follows portfolio, summary enquiries). */
const SCOPE_OF = { enquiry: 'enquiry', application: 'application', underwriting: 'underwriting', portfolio: 'portfolio', finance: 'portfolio', summary: 'enquiry' };

const REPORT_BUILDERS = {
  enquiry: analytics.enquiryReport,
  application: analytics.applicationReport,
  underwriting: analytics.underwritingReport,
  portfolio: analytics.portfolioReport,
  finance: analytics.financeReport,
  summary: analytics.summaryReport,
};

/** People the BDM / underwriter filter offers for each report. */
const BDM_OPTIONS_SQL = {
  enquiry: 'EXISTS (SELECT 1 FROM enquiries e WHERE e.assigned_to = u.user_id AND e.flag_deleted = 0)',
  summary: 'EXISTS (SELECT 1 FROM enquiries e WHERE e.assigned_to = u.user_id AND e.flag_deleted = 0)',
  application: 'EXISTS (SELECT 1 FROM applications a WHERE a.assigned_to = u.user_id AND a.flag_deleted = 0)',
  portfolio: 'EXISTS (SELECT 1 FROM applications a JOIN loans l ON l.application_id = a.application_id AND l.flag_deleted = 0 WHERE a.assigned_to = u.user_id AND a.flag_deleted = 0)',
  finance: 'EXISTS (SELECT 1 FROM applications a JOIN loans l ON l.application_id = a.application_id AND l.flag_deleted = 0 WHERE a.assigned_to = u.user_id AND a.flag_deleted = 0)',
  underwriting: 'EXISTS (SELECT 1 FROM underwriting_cases uc WHERE uc.underwriter_id = u.user_id AND uc.flag_deleted = 0)',
};
async function bdmOptions(section) {
  const where = BDM_OPTIONS_SQL[section];
  if (!where) return null;
  return safe(`bdmOptions ${section}`, () => db.queryNamed(
    `SELECT u.user_id AS id, u.full_name AS name FROM users u WHERE u.flag_deleted = 0 AND ${where} ORDER BY u.full_name`, {}), []);
}

/** Full per-module report: kpis + charts + filtered detail. */
async function moduleReport(req, section, filters) {
  const build = own(REPORT_BUILDERS, section);
  if (!build) { const e = new Error('Unknown report'); e.status = 400; throw e; }
  if (!(await canView(req, REPORT_PERM[section]))) { const e = new Error('Not permitted'); e.status = 403; throw e; }
  const f = parseFilters(filters);
  // Own-data scope: force the bdm filter to the caller unless they hold this report's All Data.
  const sid = await scopeBdm(req, section);
  if (sid) f.bdm = sid;
  const core = await build(f);
  let columns; let rows;
  if (core.detail) {
    // Client 22-10-2026: detail rows come from the same data as the charts (drill-down).
    columns = core.detail.columns;
    const like = f.search ? f.search.toLowerCase() : null;
    rows = (core.detail.rows || []).filter((r) => !like || columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(like)));
  } else {
    const spec = DETAIL[SCOPE_OF[section]];
    columns = spec.columns;
    rows = await safe(`detail ${section}`, () => spec.query(f, 500), []);
  }
  const u = (req && req.userData) || {};
  return {
    section,
    title: TITLE_OF[section],
    kpis: core.kpis,
    charts: core.charts,
    bdmOptions: sid ? null : await bdmOptions(section),
    bdmLabel: section === 'underwriting' ? 'Underwriter' : 'BDM',
    listSummary: core.listSummary || null,
    detail: { columns, rows },
    context: { filters: f, statuses: [], user_id: u.userId || null, generated_at: new Date().toISOString() },
  };
}

/* ---- Excel export for a module report ---- */
function viewToAoa(title, type, data) {
  const out = [[title]];
  if (type === 'line') {
    out.push(['Month', ...data.series.map((s) => s.name)]);
    data.labels.forEach((lab, i) => out.push([lab, ...data.series.map((s) => n(s.values[i]))]));
  } else if (type === 'bar') {
    out.push(['Category', ...data.seriesNames]);
    data.groups.forEach((g) => out.push([g.label, ...g.values.map((v) => n(v))]));
  } else if (type === 'sankey') {
    out.push(['From', 'To', 'Value']);
    (data.links || []).forEach((l) => out.push([l.source, l.target, n(l.value)]));
  } else {
    out.push(['Label', 'Value', 'Detail']);
    (data.items || []).forEach((it) => out.push([it.label, n(it.value), it.display || '']));
  }
  out.push([]);
  return out;
}
function chartToAoa(ch) {
  if (Array.isArray(ch.views) && ch.views.length) {
    return ch.views.flatMap((v) => viewToAoa(`${ch.title} — ${v.label}`, v.type || ch.type, v.data));
  }
  return viewToAoa(ch.title, ch.type, ch.data);
}

async function exportXlsx(req, section, filters) {
  const rep = await moduleReport(req, section, filters);
  const f = rep.context.filters;
  const summary = [];
  summary.push([rep.title]);
  summary.push(['Generated', new Date(rep.context.generated_at).toLocaleString('en-GB')]);
  const fl = [f.from ? `From ${f.from}` : null, f.to ? `To ${f.to}` : null, f.status ? `Status ${f.status}` : null, f.search ? `Search ${f.search}` : null].filter(Boolean).join('  ');
  summary.push(['Filters', fl || 'none (all records)']);
  summary.push([]);
  summary.push(['KPI', 'Value', 'Detail']);
  rep.kpis.forEach((k) => summary.push([k.label, k.value, k.caption || '']));
  summary.push([]);
  rep.charts.forEach((ch) => { chartToAoa(ch).forEach((r) => summary.push(r)); });

  const cols = rep.detail.columns;
  const records = [cols.map((c) => c.header)];
  rep.detail.rows.forEach((row) => records.push(cols.map((c) => {
    const v = row[c.key];
    if (c.type === 'currency') return n(v);
    if (c.type === 'number') return (v === null || v === undefined ? '' : n(v));
    if (c.type === 'date') return fmtDate(v);
    return v === null || v === undefined ? '' : String(v);
  })));

  const buffer = buildWorkbook([
    { name: 'Summary', aoa: summary },
    { name: rep.detail.columns.length ? 'Records' : 'Data', aoa: records },
  ]);
  return { filename: `${section}-report.xlsx`, buffer };
}


module.exports = { showcase, detail, exportCsv, exportPdf, moduleReport, exportXlsx, csvCell };
