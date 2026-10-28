'use strict';

/**
 * Migration: KYC Team master permission row (Roles > Add/Edit matrix).
 *
 * Same work as seeder 20260101000056_kyc_team_master.js, run here so a plain
 * `npm run migrate` is enough — the Roles matrix row was missing when only the
 * migration was run (28-09-2026). Idempotent: safe if the seeder already ran.
 */
const seeder = require('../seeders/20260101000056_kyc_team_master');

module.exports = {
  async up(db) {
    await seeder.run(db);
  },
  async down(db) {
    await db.raw(`
      DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE p.module_key = 'MASTERS.KYC_TEAM_MASTER';
      DELETE FROM permissions WHERE module_key = 'MASTERS.KYC_TEAM_MASTER';
      DELETE FROM modules WHERE module_code = 'MASTERS.KYC_TEAM_MASTER';`);
  },
};
