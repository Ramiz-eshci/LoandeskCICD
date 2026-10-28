'use strict';

/**
 * Seeder: unify the 'read' permission into 'view'.
 *
 * Historically a few scaffold/example routes checked permission_key='read'
 * while the whole permission matrix standardised on 'view'. The routes now
 * check 'view' (see routes/*.routes.js), so this migrates any existing data:
 *
 *   1) ensure every module that has a 'read' permission also has a 'view' one
 *   2) copy each role's 'read' grant onto the matching 'view' permission
 *   3) drop the old 'read' role grants
 *   4) delete the now-unused 'read' permission rows
 *
 * Safe + idempotent: once no 'read' rows remain, every statement is a no-op.
 * Behaviour is unchanged — 'read' and 'view' were synonyms.
 */

module.exports = {
  async run(db) {
    // 1) create the missing 'view' twin for any 'read' permission
    await db.raw(`
      INSERT INTO permissions (module_key, permission_key, description)
      SELECT p.module_key, 'view', 'view ' + p.module_key
        FROM permissions p
       WHERE p.permission_key = 'read'
         AND NOT EXISTS (SELECT 1 FROM permissions v
                          WHERE v.module_key = p.module_key AND v.permission_key = 'view');`);

    // 2) copy role grants from 'read' -> matching 'view' (skip ones already granted)
    await db.raw(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rp.role_id, v.permission_id
        FROM role_permissions rp
        JOIN permissions r ON r.permission_id = rp.permission_id AND r.permission_key = 'read'
        JOIN permissions v ON v.module_key = r.module_key AND v.permission_key = 'view'
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions x
                          WHERE x.role_id = rp.role_id AND x.permission_id = v.permission_id);`);

    // 3) delete the old 'read' role grants
    await db.raw(`
      DELETE rp
        FROM role_permissions rp
        JOIN permissions r ON r.permission_id = rp.permission_id AND r.permission_key = 'read';`);

    // 4) delete the 'read' permission rows themselves
    await db.raw(`DELETE FROM permissions WHERE permission_key = 'read';`);
  },
};
