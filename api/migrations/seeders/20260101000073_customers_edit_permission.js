'use strict';

/**
 * Seeder: CUSTOMERS 'edit' permission (client 16-10-2026) - edit a customer's basic details
 * (name / company / e-mail / phone) on Customer 360. Granted to System Administrator (role 1);
 * other roles are ticked in the Roles matrix. Idempotent.
 */
module.exports = {
  async run(db) {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key='CUSTOMERS' AND permission_key='edit')
         INSERT INTO permissions (module_key, permission_key, description) VALUES ('CUSTOMERS', 'edit', 'edit CUSTOMERS');`,
    );
    await db.raw(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT 1, p.permission_id FROM permissions p
       WHERE p.module_key = 'CUSTOMERS' AND p.permission_key = 'edit' AND EXISTS (SELECT 1 FROM roles WHERE role_id = 1)
         AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = 1 AND x.permission_id = p.permission_id);`);
  },
};
