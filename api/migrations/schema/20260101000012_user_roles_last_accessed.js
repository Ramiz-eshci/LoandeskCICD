'use strict';

/**
 * Migration: per-role "last accessed" stamp for the Select-Your-Workspace
 * screen. Each user_roles row records when that workspace/role was last
 * entered (set on OTP login for the active role and on every /auth/select-role).
 * Additive + guarded; safe to re-run.
 */

module.exports = {
  async up(db) {
    await db.raw(
      `IF COL_LENGTH('dbo.user_roles','last_accessed_at') IS NULL
         ALTER TABLE dbo.user_roles ADD last_accessed_at DATETIME2 NULL;`
    );
  },

  async down(db) {
    await db.raw(
      `IF COL_LENGTH('dbo.user_roles','last_accessed_at') IS NOT NULL
         ALTER TABLE dbo.user_roles DROP COLUMN last_accessed_at;`
    );
  },
};
