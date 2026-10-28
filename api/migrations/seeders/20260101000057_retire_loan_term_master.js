'use strict';

/**
 * Seeder: retire the Loan Term master (28-09-2026).
 *
 * The Loan Term master (loan_terms) is not used anywhere: no screen, dropdown,
 * report or service reads it. Its sidebar entry, master CRUD config and
 * permission mappings were removed from the code; this seeder removes its
 * permission module from the database so the Roles matrix no longer shows a
 * "Loan Term" row:
 *   role_permissions -> permissions -> modules for MASTERS.LOAN_TERM_MASTER.
 *
 * The loan_terms TABLE and its rows are intentionally left in place (no data
 * is dropped). Safe + idempotent: DELETEs are no-ops once the rows are gone.
 */
const OBSOLETE = 'MASTERS.LOAN_TERM_MASTER';

module.exports = {
  async run(db) {
    await db.query(
      `DELETE rp
         FROM role_permissions rp
         JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE p.module_key = @p0`,
      [OBSOLETE],
    );
    await db.query(`DELETE FROM permissions WHERE module_key = @p0`, [OBSOLETE]);
    await db.query(`DELETE FROM modules WHERE module_code = @p0`, [OBSOLETE]);
  },
};
