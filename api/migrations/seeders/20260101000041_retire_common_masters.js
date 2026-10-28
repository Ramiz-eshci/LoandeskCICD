'use strict';

/**
 * Seeder: retire the bundled "Common Masters" permission.
 *
 * Every individual master now has its own module + permissions (see the
 * updated loandesk_matrix.json, applied by 20260101000004_modules_matrix.js).
 * This seeder removes the now-obsolete MASTERS.COMMON_MASTERS permission rows
 * and their role grants so the permission matrix no longer shows a lumped
 * "Common Masters" row. The module record itself is kept (harmless fallback).
 *
 * Safe + idempotent: DELETEs are no-ops once the rows are gone. Nothing here
 * touches the per-master permissions seeded from the sheet.
 */

const OBSOLETE = 'MASTERS.COMMON_MASTERS';

module.exports = {
  async run(db) {
    // drop role grants that point at the obsolete permission
    await db.query(
      `DELETE rp
         FROM role_permissions rp
         JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE p.module_key = @p0`,
      [OBSOLETE],
    );
    // drop the obsolete permission catalog rows
    await db.query(`DELETE FROM permissions WHERE module_key = @p0`, [OBSOLETE]);
  },
};
