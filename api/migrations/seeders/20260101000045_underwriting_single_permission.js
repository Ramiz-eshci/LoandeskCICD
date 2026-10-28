'use strict';

/**
 * Seeder: one Underwriting permission row in the Roles matrix.
 *
 * The UNDERWRITING group showed two rows:
 *   - "Underwriting"      (module_key UNDERWRITING)      — old coarse catalogue from
 *     master_data. NOT enforced by any API route; it only made the menu appear.
 *   - "Underwriting Case" (module_key UNDERWRITING.CASE) — the REAL one: every
 *     /api/underwriting route checks it (view / accept / act / decide / query /
 *     respond / reject / assign).
 *
 * This seeder:
 *   1) renames "Underwriting Case" -> "Underwriting" (module_code unchanged)
 *   2) deletes the old UNDERWRITING permission rows + their role grants
 *      (the UNDERWRITING module row stays as the group header).
 *
 * The menu / route guard now read UNDERWRITING.CASE, so nothing depends on the
 * removed rows. Idempotent.
 */

module.exports = {
  async run(db) {
    await db.raw(`
      UPDATE modules SET module_name = N'Underwriting' WHERE module_code = 'UNDERWRITING.CASE';

      DELETE rp FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id AND p.module_key = 'UNDERWRITING';
      DELETE FROM permissions WHERE module_key = 'UNDERWRITING';`);
  },
};
