'use strict';

/**
 * Seeder: Final Credit Committee decision rights (client 20-10-2026).
 *
 *   UNDERWRITING_STAGES.CREDIT_COMMITTEE  approve -> "Agree to Fund"
 *   UNDERWRITING_STAGES.CREDIT_COMMITTEE  reject  -> "Cannot Proceed - Close"
 *
 * Adds the APPROVE / REJECT columns on Roles > Underwriting Stages > 5. Final Credit
 * Committee. Granted to System Administrator (role 1) only; tick other roles in Roles.
 * Enforced in services/underwriting.service.js (canCommittee) + underwriting-detail UI.
 * Idempotent.
 */
const MOD = 'UNDERWRITING_STAGES.CREDIT_COMMITTEE';
module.exports = {
  async run(db) {
    for (const act of ['approve', 'reject']) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
           INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
        [MOD, act, `${act} ${MOD}`]);
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT 1, p.permission_id FROM permissions p
          WHERE p.module_key = @p0 AND p.permission_key = @p1 AND EXISTS (SELECT 1 FROM roles WHERE role_id = 1)
            AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = 1 AND x.permission_id = p.permission_id);`,
        [MOD, act]);
    }
  },
};
