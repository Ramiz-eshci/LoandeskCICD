'use strict';

/**
 * Seeder: Offer "accept" action + separate CUSTOMERS module.
 *
 *  1) ENQUIRIES.OFFER.accept — the Roles matrix ACCEPT tick on "Offer" now
 *     controls the enquiry "Mark Accepted" button (and the per-offer "Mark
 *     accepted" link / API). Granted to System Administrator only; tick it for
 *     every other role that should accept offers.
 *
 *  2) CUSTOMERS (top-level "Customers" module): view only.
 *     Drives the Customers menu, the customers list and Customer 360.
 *     Customer 360 documents live under CUSTOMERS.DOCUMENT (seeder 048). It replaces the old unused
 *     CLIENT permission and no longer depends on PORTFOLIO.CUSTOMER_360.
 *     Customer Conversion, Customer 360 and Customer Logs stay unchanged in
 *     the Portfolio group.
 *     Baseline: every role that held PORTFOLIO.CUSTOMER_360.view gets
 *     CUSTOMERS.view.
 *
 *  3) Removes the orphan CLIENT permission rows (never granted in the matrix).
 *
 * Idempotent: guarded inserts only; the copy steps skip existing grants.
 */

module.exports = {
  async run(db) {
    // 1) Offer accept
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key='ENQUIRIES.OFFER' AND permission_key='accept')
         INSERT INTO permissions (module_key, permission_key, description) VALUES ('ENQUIRIES.OFFER', 'accept', 'accept ENQUIRIES.OFFER');`,
    );
    await db.query(
      `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key='ENQUIRIES.OFFER' AND permission_key='accept');
       IF @p IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE role_id=1)
          AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=1 AND permission_id=@p)
         INSERT INTO role_permissions (role_id, permission_id) VALUES (1, @p);`,
    );

    // 2) CUSTOMERS module + catalogue
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code='CUSTOMERS')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES ('CUSTOMERS', 'Customers', NULL, 45);
       ELSE
         UPDATE modules SET module_name='Customers', parent_code=NULL, sort_order=45 WHERE module_code='CUSTOMERS';`,
    );
    for (const act of ['view']) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key='CUSTOMERS' AND permission_key=@p0)
           INSERT INTO permissions (module_key, permission_key, description) VALUES ('CUSTOMERS', @p0, @p1);`,
        [act, act + ' CUSTOMERS'],
      );
    }

    // baseline grants copied from PORTFOLIO.CUSTOMER_360 (by role, not by name)
    const copy = async (fromActs, toAct) => {
      const list = fromActs.map((a) => `'${a}'`).join(',');
      await db.raw(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT DISTINCT rp.role_id, t.permission_id
          FROM role_permissions rp
          JOIN permissions f ON f.permission_id = rp.permission_id
                            AND f.module_key = 'PORTFOLIO.CUSTOMER_360' AND f.permission_key IN (${list})
          JOIN permissions t ON t.module_key = 'CUSTOMERS' AND t.permission_key = '${toAct}'
         WHERE NOT EXISTS (SELECT 1 FROM role_permissions x
                            WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);`);
    };
    await copy(['view'], 'view');
    // System Administrator: full
    await db.raw(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT 1, p.permission_id FROM permissions p
       WHERE p.module_key = 'CUSTOMERS' AND EXISTS (SELECT 1 FROM roles WHERE role_id = 1)
         AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = 1 AND x.permission_id = p.permission_id);`);

    // 3) drop orphan CLIENT permission (replaced by CUSTOMERS)
    await db.raw(`
      DELETE rp FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id AND p.module_key = 'CLIENT';
      DELETE FROM permissions WHERE module_key = 'CLIENT';`);
  },
};
