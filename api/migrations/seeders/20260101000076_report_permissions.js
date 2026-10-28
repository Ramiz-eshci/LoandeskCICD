'use strict';

/**
 * Seeder: one Roles-matrix row per report + own/all data scope (client 26-10-2026).
 *
 *   REPORTS.<X>      view  - can open that report (sidebar + route + API)
 *   REPORTS.<X>_ALL  view  - sees everyone's data in it; without it the report is
 *                            forced to the user's OWN deals (BDM / owner = assigned_to,
 *                            underwriter for Underwriting). Reports only - the list
 *                            screens keep their own ALL_* permissions.
 *
 * The single "Reports" row (REPORTS view) is replaced by these rows and removed.
 * First run only (when a row is created): each role keeps what it had -
 *   REPORTS.<X> view      <- REPORTS view AND the old underlying module view
 *   REPORTS.<X>_ALL view  <- REPORTS.<X> view AND the module's ALL_* view
 * Super / company admins bypass RBAC anyway. Idempotent.
 */

// [code suffix, name, sort, old module gate, old ALL_* key]
const REPORTS = [
  ['SUMMARY', 'Overall Summary', 1, 'ENQUIRIES.ENQUIRY_LIST', 'ENQUIRIES.ALL_ENQUIRIES'],
  ['ENQUIRY', 'Enquiry Report', 3, 'ENQUIRIES.ENQUIRY_LIST', 'ENQUIRIES.ALL_ENQUIRIES'],
  ['APPLICATION', 'Application Report', 5, 'APPLICATIONS.APPLICATION_LIST', 'APPLICATIONS.ALL_APPLICATIONS'],
  ['UNDERWRITING', 'Underwriting Report', 7, 'UNDERWRITING.CASE', 'UNDERWRITING.ALL_CASES'],
  ['PORTFOLIO', 'Portfolio Report', 9, 'PORTFOLIO', 'PORTFOLIO.ALL_PORTFOLIO'],
  ['FINANCE', 'Income & Cashflow', 11, 'PORTFOLIO', 'PORTFOLIO.ALL_PORTFOLIO'],
];

async function ensureModule(db, code, name, sort) {
  await db.query(
    `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = @p0)
       INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, @p1, 'REPORTS', @p2);
     ELSE UPDATE modules SET module_name = @p1, parent_code = 'REPORTS', sort_order = @p2 WHERE module_code = @p0;`,
    [code, name, sort]);
}

/** Create MOD view if missing; returns true when it was created now (first run). */
async function ensureView(db, mod) {
  const rows = await db.query(
    `DECLARE @c TABLE (id INT);
     IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = @p0 AND permission_key = 'view')
       INSERT INTO permissions (module_key, permission_key, description) OUTPUT inserted.permission_id INTO @c VALUES (@p0, 'view', @p1);
     SELECT COUNT(*) AS created FROM @c;`,
    [mod, `view ${mod}`]);
  return Number(rows[0] && rows[0].created) > 0;
}

/** Grant MOD view to every role holding both (aMod view) and (bMod view). */
async function grantWhereBoth(db, mod, aMod, bMod) {
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT DISTINCT ra.role_id, t.permission_id
       FROM role_permissions ra
       JOIN permissions pa ON pa.permission_id = ra.permission_id AND pa.module_key = @p1 AND pa.permission_key = 'view'
       JOIN role_permissions rb ON rb.role_id = ra.role_id
       JOIN permissions pb ON pb.permission_id = rb.permission_id AND pb.module_key = @p2 AND pb.permission_key = 'view'
       JOIN permissions t ON t.module_key = @p0 AND t.permission_key = 'view'
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = ra.role_id AND x.permission_id = t.permission_id);`,
    [mod, aMod, bMod]);
}

module.exports = {
  async run(db) {
    for (const [code, name, sort, gate, allKey] of REPORTS) {
      const mod = `REPORTS.${code}`;
      const all = `${mod}_ALL`;
      await ensureModule(db, mod, name, sort);
      await ensureModule(db, all, `${name} - All Data`, sort + 1);
      if (await ensureView(db, mod)) await grantWhereBoth(db, mod, 'REPORTS', gate);
      if (await ensureView(db, all)) await grantWhereBoth(db, all, mod, allKey);
    }

    // The old single "Reports" row is now the group header only (re-seeded by the base
    // matrix / role_matrix_sync, so dropped on every run).
    await db.query(
      `DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id WHERE p.module_key = 'REPORTS';
       DELETE FROM permissions WHERE module_key = 'REPORTS';`);
  },
};
