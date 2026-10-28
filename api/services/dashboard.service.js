'use strict';

/**
 * Dashboard service — REAL figures, gated by the caller's role permissions.
 *
 * Two independent rules, do not confuse them:
 *
 *  1. VISIBILITY — may this role see this tile at all? Driven by the module's
 *     `view` permission. Without it the tile is OMITTED from the payload
 *     entirely; it is never returned as zero, because a zero is still a fact
 *     about data the user may not see.
 *
 *  2. SCOPE — how much of the module may they see? Mirrors the rule already
 *     used by the enquiry list (controllers/enquiry.controller.viewScopeUserId):
 *     holding ENQUIRIES.ALL_ENQUIRIES.view means every row; otherwise only rows
 *     assigned to the caller. Tile and list therefore always agree.
 *
 * Enquiries, applications and underwriting each have an ALL_* "see everything"
 * module in the catalog; a role without it sees only its own rows (enquiries /
 * applications it is assigned to, cases it underwrites) — exactly as the list
 * screens behave. The map below is the single switch for that.
 *
 * A03: every value is bound (@pN). No identifier ever comes from the request.
 */

const db = require('../config/database');
const { roleHasPermission } = require('../middlewares/rbac');

/** module_key -> the "see everything" permission that lifts assignee scoping. */
const SCOPE_RULES = {
  'ENQUIRIES.ENQUIRY_LIST': { module: 'ENQUIRIES.ALL_ENQUIRIES', action: 'view' },
  // Client 07-10-2026: a user without the module's "see all" permission (e.g. a BDM)
  // sees only their OWN rows on the dashboard — the same rule the list screens use.
  // These ALL_* modules are all seeded (rbac_modules_v3, underwriting_all_cases).
  'APPLICATIONS.APPLICATION_LIST': { module: 'APPLICATIONS.ALL_APPLICATIONS', action: 'view' },
  'UNDERWRITING.CASE': { module: 'UNDERWRITING.ALL_CASES', action: 'view' },
};

function isAdmin(req) {
  const u = (req && req.userData) || {};
  return !!(u.isSuperAdmin || u.isCompanyAdmin);
}
function actorId(req) {
  const u = (req && req.userData) || {};
  return u.userId || 0;
}

/** Can this caller see the module at all? */
async function canView(req, moduleKey) {
  if (isAdmin(req)) return true;
  const u = (req && req.userData) || {};
  return roleHasPermission(u.roleId, moduleKey, 'view');
}

/**
 * user_id to scope a module's rows to, or null for unrestricted.
 * null = see everything (admin, or the role holds the module's ALL_* permission).
 */
async function scopeUserId(req, moduleKey) {
  if (isAdmin(req)) return null;
  const rule = SCOPE_RULES[moduleKey];
  if (!rule) return null; // no ALL_* module defined yet -> behave like the list screen
  const u = (req && req.userData) || {};
  const all = await roleHasPermission(u.roleId, rule.module, rule.action);
  return all ? null : actorId(req);
}

/** Run a query, never let one bad tile take down the whole dashboard. */
async function safe(label, fn, fallback) {
  try { return await fn(); } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[dashboard] ${label} failed:`, e && e.message);
    return fallback;
  }
}

const n = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);

/* ------------------------------------------------------------------ */
/*  Tiles                                                             */
/* ------------------------------------------------------------------ */

async function enquiryTiles(req, tiles, sections) {
  const MOD = 'ENQUIRIES.ENQUIRY_LIST';
  if (!(await canView(req, MOD))) return;
  const uid = await scopeUserId(req, MOD);
  const scoped = uid ? ' AND e.assigned_to = @p0' : '';
  const params = uid ? [uid] : [];

  const row = await safe('enquiries', () => db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN e.created_at >= DATEADD(day, -30, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS last30,
       SUM(CASE WHEN s.is_terminal = 0 THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN s.is_terminal = 0 THEN ISNULL(e.amount_requested, 0) ELSE 0 END) AS open_value
     FROM enquiries e
     LEFT JOIN enquiry_statuses s ON s.enquiry_status_id = e.enquiry_status_id
     WHERE e.flag_deleted = 0${scoped}`, params), []);
  const r = row[0] || {};

  tiles.push({
    key: 'enquiries_new', module: MOD, label: 'New Enquiries', value: n(r.last30),
    caption: 'Last 30 days', icon: 'bi-file-earmark-text', tone: 'default',
    scoped: !!uid,
  });
  tiles.push({
    key: 'enquiries_open', module: MOD, label: 'Total Active Enquiries', value: n(r.open_count),
    caption: uid ? 'Assigned to you' : 'All enquiries', icon: 'bi-inbox', tone: 'default',
    scoped: !!uid,
  });
  tiles.push({
    key: 'enquiries_value', module: MOD, label: 'Active Enquiry Value', value: n(r.open_value),
    caption: 'Requested amount', icon: 'bi-currency-pound', tone: 'default',
    format: 'currency', scoped: !!uid,
  });

  sections.enquiry_pipeline = await safe('enquiry pipeline', async () => {
    const rows = await db.query(
      `SELECT s.code, s.name, s.sort_order, COUNT(e.enquiry_id) AS total
         FROM enquiry_statuses s
         LEFT JOIN enquiries e
           ON e.enquiry_status_id = s.enquiry_status_id AND e.flag_deleted = 0${scoped}
        WHERE s.flag_deleted = 0 AND s.is_active = 1
        GROUP BY s.code, s.name, s.sort_order
        ORDER BY s.sort_order`, params);
    return rows.map((x) => ({ code: x.code, label: x.name, value: n(x.total) }));
  }, []);
}

async function applicationTiles(req, tiles, sections) {
  const MOD = 'APPLICATIONS.APPLICATION_LIST';
  if (!(await canView(req, MOD))) return;
  const uid = await scopeUserId(req, MOD);
  const scoped = uid ? ' AND a.assigned_to = @p0' : '';
  const params = uid ? [uid] : [];

  const row = await safe('applications', () => db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN st.is_terminal = 0 THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN st.is_terminal = 0 THEN ISNULL(a.amount_requested, 0) ELSE 0 END) AS active_value
     FROM applications a
     LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
     WHERE a.flag_deleted = 0${scoped}`, params), []);
  const r = row[0] || {};

  tiles.push({
    key: 'applications_active', module: MOD, label: 'Active Applications', value: n(r.active_count),
    caption: uid ? 'Assigned to you' : 'In the pipeline', icon: 'bi-folder2-open', tone: 'default',
    scoped: !!uid,
  });
  tiles.push({
    key: 'applications_value', module: MOD, label: 'Pipeline Value', value: n(r.active_value),
    caption: 'Requested amount', icon: 'bi-graph-up-arrow', tone: 'positive',
    format: 'currency', scoped: !!uid,
  });

  sections.product_mix = await safe('product mix', async () => {
    const rows = await db.query(
      `SELECT ISNULL(p.name, 'Unspecified') AS label, COUNT(a.application_id) AS total
         FROM applications a
         LEFT JOIN products p ON p.product_id = a.product_id
        WHERE a.flag_deleted = 0${scoped}
        GROUP BY p.name
        ORDER BY COUNT(a.application_id) DESC`, params);
    return rows.map((x) => ({ label: x.label, value: n(x.total) }));
  }, []);

  sections.recent_applications = await safe('recent applications', async () => {
    const rows = await db.query(
      `SELECT TOP 8 a.application_id, a.application_ref, a.amount_requested, a.created_at,
              st.name AS status_name, st.code AS status_code,
              ISNULL(p.name, '—') AS product_name,
              ISNULL(ap.company_name, LTRIM(RTRIM(ISNULL(ap.first_name,'') + ' ' + ISNULL(ap.last_name,'')))) AS applicant_name
         FROM applications a
         LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
         LEFT JOIN products p ON p.product_id = a.product_id
         LEFT JOIN application_applicants aa
                ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
         LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
        WHERE a.flag_deleted = 0${scoped}
        ORDER BY a.created_at DESC`, params);
    return rows.map((x) => ({
      application_id: x.application_id,
      application_ref: x.application_ref,
      applicant_name: (x.applicant_name || '').trim() || '—',
      product_name: x.product_name,
      amount_requested: n(x.amount_requested),
      status_name: x.status_name,
      status_code: x.status_code,
      created_at: x.created_at,
    }));
  }, []);
}

async function underwritingTiles(req, tiles, sections) {
  const MOD = 'UNDERWRITING.CASE';
  if (!(await canView(req, MOD))) return;
  const uid = await scopeUserId(req, MOD);
  const scoped = uid ? ' AND uc.underwriter_id = @p0' : '';
  const params = uid ? [uid] : [];

  const row = await safe('underwriting', () => db.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN uc.status NOT IN ('Rejected','Closed','In Portfolio') THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN uc.status NOT IN ('Rejected','Closed','In Portfolio') THEN ISNULL(a.amount_requested, 0) ELSE 0 END) AS open_value
       FROM underwriting_cases uc
       LEFT JOIN applications a ON a.application_id = uc.application_id AND a.flag_deleted = 0
      WHERE uc.flag_deleted = 0${scoped}`, params), []);
  const r = row[0] || {};
  tiles.push({
    key: 'underwriting_open', module: MOD, label: 'Total Active Underwriting', value: n(r.open_count),
    caption: uid ? 'Assigned to you' : 'Open cases', icon: 'bi-clipboard-check', tone: 'warning',
    scoped: !!uid,
  });
  tiles.push({
    key: 'underwriting_value', module: MOD, label: 'Active Underwriting Value', value: n(r.open_value),
    caption: 'Requested amount', icon: 'bi-cash-stack', tone: 'default',
    format: 'currency', scoped: !!uid,
  });

  sections.underwriting_status = await safe('underwriting status', async () => {
    const rows = await db.query(
      `SELECT uc.status AS label, COUNT(*) AS total
         FROM underwriting_cases uc
        WHERE uc.flag_deleted = 0${scoped}
        GROUP BY uc.status
        ORDER BY COUNT(*) DESC`, params);
    return rows.map((x) => ({ label: x.label || 'Unknown', value: n(x.total) }));
  }, []);
}

async function portfolioTiles(req, tiles, sections) {
  const MOD = 'PORTFOLIO';
  if (!(await canView(req, MOD))) return;

  const row = await safe('portfolio', () => db.query(
    `SELECT COUNT(*) AS total,
            SUM(COALESCE(l.outstanding_balance, l.principal, 0)) AS value,
            SUM(CASE WHEN l.maturity_date >= DATEADD(day, -30, CAST(GETUTCDATE() AS date))
                      AND l.maturity_date <= CAST(GETUTCDATE() AS date) THEN 1 ELSE 0 END) AS matured30
       FROM loans l
      WHERE l.flag_deleted = 0 AND l.status = 'Active'`), []);
  const r = row[0] || {};
  tiles.push({
    key: 'portfolio_active', module: MOD, label: 'Total Active Portfolio', value: n(r.total),
    caption: 'Live facilities', icon: 'bi-building', tone: 'default', scoped: false,
  });
  tiles.push({
    key: 'portfolio_value', module: MOD, label: 'Active Portfolio Value', value: n(r.value),
    caption: 'Outstanding balance', icon: 'bi-cash-coin', tone: 'positive',
    format: 'currency', scoped: false,
  });
  tiles.push({
    key: 'maturity_30d', module: MOD, label: 'Total Maturity (Last 30 Days)', value: n(r.matured30),
    caption: 'Matured in last 30 days', icon: 'bi-calendar-check', tone: 'warning', scoped: false,
  });

  sections.maturity_buckets = await safe('maturity buckets', async () => {
    const b = await db.query(
      `SELECT
         SUM(CASE WHEN l.maturity_date >= CAST(GETUTCDATE() AS date) AND l.maturity_date <= DATEADD(day,30,CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS b30,
         SUM(CASE WHEN l.maturity_date > DATEADD(day,30,CAST(GETUTCDATE() AS date)) AND l.maturity_date <= DATEADD(day,60,CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS b60,
         SUM(CASE WHEN l.maturity_date > DATEADD(day,60,CAST(GETUTCDATE() AS date)) AND l.maturity_date <= DATEADD(day,90,CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS b90,
         SUM(CASE WHEN l.maturity_date > DATEADD(day,90,CAST(GETUTCDATE() AS date)) THEN 1 ELSE 0 END) AS blater
       FROM loans l WHERE l.flag_deleted = 0 AND l.status = 'Active'`);
    const x = b[0] || {};
    return [
      { label: '≤ 30 days', value: n(x.b30) },
      { label: '31–60 days', value: n(x.b60) },
      { label: '61–90 days', value: n(x.b90) },
      { label: '90+ days', value: n(x.blater) },
    ];
  }, []);
}

async function statusTile(req, tiles, { moduleKey, code, key, label, caption, icon, tone }) {
  if (!(await canView(req, moduleKey))) return;
  const row = await safe(key, () => db.query(
    `SELECT COUNT(*) AS total
       FROM applications a
       JOIN application_statuses st ON st.application_status_id = a.application_status_id
      WHERE a.flag_deleted = 0 AND st.code = @p0`, [code]), []);
  tiles.push({
    key, module: moduleKey, label, value: n(row[0] && row[0].total),
    caption, icon, tone, scoped: false,
  });
}

/* ------------------------------------------------------------------ */

/** Build the whole dashboard payload for this caller. */
async function summary(req) {
  const tiles = [];
  const sections = {};

  await enquiryTiles(req, tiles, sections);
  await applicationTiles(req, tiles, sections);
  await underwritingTiles(req, tiles, sections);
  await portfolioTiles(req, tiles, sections);
  // Client 13-10-2026: Credit Queue and In Legal tiles removed (not in use).

  const u = (req && req.userData) || {};
  return {
    tiles,
    ...sections,
    context: {
      user_id: u.userId || null,
      role_id: u.roleId || null,
      is_admin: isAdmin(req),
      // true when at least one tile is narrowed to the caller's own rows
      any_scoped: tiles.some((t) => t.scoped),
      generated_at: new Date().toISOString(),
    },
  };
}

module.exports = { summary, canView, scopeUserId, SCOPE_RULES };
