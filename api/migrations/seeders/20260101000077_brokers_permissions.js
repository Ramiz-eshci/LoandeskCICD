'use strict';

/**
 * Seeder: Brokers gets its own Roles-matrix group, like Customers (client 26-10-2026).
 *
 *   BROKERS            view / add / edit / delete  - "Broker List": Brokers menu, broker
 *                                                     dashboard, add / edit broker
 *   BROKERS.DOCUMENT   view / add / delete         - "Brokers Document": broker agreement etc.
 *
 * Replaces the Masters > Broker row (MASTERS.BROKER_MASTER), which is removed. First run
 * only (when a row is created): each role keeps what it had on the old row -
 *   BROKERS <act>             <- MASTERS.BROKER_MASTER <act>
 *   BROKERS.DOCUMENT view     <- MASTERS.BROKER_MASTER view
 *   BROKERS.DOCUMENT add      <- MASTERS.BROKER_MASTER edit   (upload was gated on edit)
 *   BROKERS.DOCUMENT delete   <- MASTERS.BROKER_MASTER delete
 * Super / company admins bypass RBAC anyway. Idempotent.
 */

const OLD = 'MASTERS.BROKER_MASTER';
// [module, action, copied from OLD action]
const WANT = [
  ['BROKERS', 'view', 'view'],
  ['BROKERS', 'add', 'add'],
  ['BROKERS', 'edit', 'edit'],
  ['BROKERS', 'delete', 'delete'],
  ['BROKERS.DOCUMENT', 'view', 'view'],
  ['BROKERS.DOCUMENT', 'add', 'edit'],
  ['BROKERS.DOCUMENT', 'delete', 'delete'],
];

module.exports = {
  async run(db) {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'BROKERS')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES ('BROKERS', N'Brokers', NULL, 46);
       IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'BROKERS.DOCUMENT')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES ('BROKERS.DOCUMENT', N'Brokers Document', 'BROKERS', 1);`);

    for (const [mod, act, from] of WANT) {
      const rows = await db.query(
        `DECLARE @c TABLE (id INT);
         IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = @p0 AND permission_key = @p1)
           INSERT INTO permissions (module_key, permission_key, description) OUTPUT inserted.permission_id INTO @c VALUES (@p0, @p1, @p2);
         SELECT COUNT(*) AS created FROM @c;`,
        [mod, act, `${act} ${mod}`]);
      if (!(Number(rows[0] && rows[0].created) > 0)) continue;
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT DISTINCT rp.role_id, t.permission_id
           FROM role_permissions rp
           JOIN permissions f ON f.permission_id = rp.permission_id AND f.module_key = @p2 AND f.permission_key = @p3
           JOIN permissions t ON t.module_key = @p0 AND t.permission_key = @p1
          WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);`,
        [mod, act, OLD, from]);
    }

    // Old Masters > Broker row (re-seeded by the base matrix / masters rename, so dropped on every run).
    await db.query(
      `DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id WHERE p.module_key = @p0;
       DELETE FROM permissions WHERE module_key = @p0;
       DELETE FROM modules WHERE module_code = @p0;`,
      [OLD]);
  },
};
