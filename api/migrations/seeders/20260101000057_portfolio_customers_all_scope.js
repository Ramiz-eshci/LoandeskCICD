'use strict';

/**
 * Seeder: "All Portfolio" and "All Customers" see-everything permissions
 * (client 29-09-2026) — same pattern as ENQUIRIES.ALL_ENQUIRIES vs Enquiries List.
 *
 *   PORTFOLIO.ALL_PORTFOLIO.view  -> every facility
 *   PORTFOLIO.view (shown as "Portfolio List") only
 *                                 -> only facilities the user worked on
 *   CUSTOMERS.ALL_CUSTOMERS.view  -> every customer
 *   CUSTOMERS.view (shown as "Customer List") only
 *                                 -> only customers the user worked on
 *
 * "Worked on" = BDM / underwriter / credit manager on the application, or the
 * owner of the source enquiry (see middlewares/portfolio-scope.js).
 *
 * Baseline grants go to the same role ids as ALL_ENQUIRIES:
 *   1 System Administrator, 3 Underwriter, 4 Credit Manager,
 *   8 Branch Manager, 10 Auditor, 12 Head of Sales.
 * The grant runs ONLY when the permission is first created, so an admin who
 * later unticks it for a role is not overridden on the next `npm run seed`.
 * Additive and idempotent.
 */

const SEE_ALL_ROLE_IDS = [1, 3, 4, 8, 10, 12];

const MODULES = [
  // code, name, parent, description
  ['PORTFOLIO.ALL_PORTFOLIO', 'All Portfolio', 'PORTFOLIO', 'See every portfolio facility, not only your own'],
  ['CUSTOMERS.ALL_CUSTOMERS', 'All Customers', 'CUSTOMERS', 'See every customer, not only your own'],
];

module.exports = {
  async run(db) {
    for (const [code, name, parent, desc] of MODULES) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = @p0)
           INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, @p1, @p2, 1);
         ELSE
           UPDATE modules SET module_name = @p1, parent_code = @p2 WHERE module_code = @p0;`,
        [code, name, parent]);

      // eslint-disable-next-line no-await-in-loop
      const existed = await db.query(
        'SELECT 1 AS x FROM permissions WHERE module_key = @p0 AND permission_key = \'view\'', [code]);
      if (existed.length) continue;

      // eslint-disable-next-line no-await-in-loop
      await db.query(
        'INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, \'view\', @p1);',
        [code, desc]);

      for (const rid of SEE_ALL_ROLE_IDS) {
        // eslint-disable-next-line no-await-in-loop
        await db.query(
          `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key = @p1 AND permission_key = 'view');
           IF @p IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE role_id = @p0)
              AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = @p0 AND permission_id = @p)
             INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
          [rid, code]);
      }
    }
  },
};
