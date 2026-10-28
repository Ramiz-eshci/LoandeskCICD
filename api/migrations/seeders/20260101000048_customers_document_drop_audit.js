'use strict';

/**
 * Seeder: Customers clean-up + "Customers Document" screen + drop AUDIT perms.
 *
 *  1) CUSTOMERS keeps VIEW only. Customers cannot be added or deleted from the
 *     app, so the CUSTOMERS add / delete permissions (and their grants) go.
 *
 *  2) CUSTOMERS.DOCUMENT ("Customers Document", under Customers) with
 *     view / upload / delete — drives the Customer 360 Documents tab:
 *       view   -> Documents tab + View + Download buttons
 *       upload -> Upload button
 *       delete -> Delete button
 *     Baseline (first run only, when the screen is created):
 *       view   <- CUSTOMERS.view
 *       upload <- CUSTOMERS.add    (or PORTFOLIO.CUSTOMER_360 add/edit)
 *       delete <- CUSTOMERS.delete (or PORTFOLIO.CUSTOMER_360 add/edit)
 *     System Administrator (role 1) gets all three.
 *
 *  3) AUDIT + AUDIT.AUDIT_LOG removed from the Roles matrix (permissions,
 *     grants and module rows). Runs after 04_modules_matrix on every seed.
 *
 * Idempotent.
 */

const DOC = 'CUSTOMERS.DOCUMENT';

module.exports = {
  async run(db) {
    const existed = (await db.query(`SELECT 1 AS x FROM modules WHERE module_code = @p0`, [DOC])).length > 0;

    // 2) Customers Document screen + catalogue
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = @p0)
         INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, N'Customers Document', 'CUSTOMERS', 1);
       ELSE
         UPDATE modules SET module_name = N'Customers Document', parent_code = 'CUSTOMERS', sort_order = 1 WHERE module_code = @p0;`,
      [DOC],
    );
    for (const act of ['view', 'upload', 'delete']) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = @p0 AND permission_key = @p1)
           INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
        [DOC, act, `${act} ${DOC}`],
      );
    }

    const grantFrom = async (srcModule, srcActs, toAct) => {
      const list = srcActs.map((a) => `'${a}'`).join(',');
      await db.raw(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT DISTINCT rp.role_id, t.permission_id
          FROM role_permissions rp
          JOIN permissions f ON f.permission_id = rp.permission_id
                            AND f.module_key = '${srcModule}' AND f.permission_key IN (${list})
          JOIN permissions t ON t.module_key = '${DOC}' AND t.permission_key = '${toAct}'
         WHERE NOT EXISTS (SELECT 1 FROM role_permissions x
                            WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);`);
    };

    if (!existed) {
      await grantFrom('CUSTOMERS', ['view'], 'view');
      await grantFrom('CUSTOMERS', ['add'], 'upload');
      await grantFrom('CUSTOMERS', ['delete'], 'delete');
      await grantFrom('PORTFOLIO.CUSTOMER_360', ['add', 'edit'], 'upload');
      await grantFrom('PORTFOLIO.CUSTOMER_360', ['add', 'edit'], 'delete');
    }
    // System Administrator: full
    await db.raw(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT 1, p.permission_id FROM permissions p
       WHERE p.module_key = '${DOC}' AND EXISTS (SELECT 1 FROM roles WHERE role_id = 1)
         AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = 1 AND x.permission_id = p.permission_id);`);

    // 1) CUSTOMERS: view only
    await db.raw(`
      DELETE rp FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE p.module_key = 'CUSTOMERS' AND p.permission_key <> 'view';
      DELETE FROM permissions WHERE module_key = 'CUSTOMERS' AND permission_key <> 'view';`);

    // 3) drop AUDIT from the matrix
    await db.raw(`
      DELETE rp FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE p.module_key = 'AUDIT' OR p.module_key LIKE 'AUDIT.%';
      DELETE FROM permissions WHERE module_key = 'AUDIT' OR module_key LIKE 'AUDIT.%';
      DELETE FROM modules WHERE module_code = 'AUDIT' OR module_code LIKE 'AUDIT.%';`);
  },
};
