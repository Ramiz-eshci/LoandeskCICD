'use strict';

/**
 * Migration: persist the ACTIVE ROLE against the refresh-token record.
 *
 * Bug: /auth/select-role only re-signs the access token (in-memory on the
 * client) — it never persisted which role the user switched to. On a page
 * reload the client calls /auth/refresh, which minted a new access token by
 * re-picking the PRIMARY role every time (pickActiveRole default), silently
 * discarding whatever role the user had switched to. This column lets
 * /auth/refresh carry the last-selected role forward instead of resetting it.
 * Additive + guarded (COL_LENGTH) — never destructive.
 */
module.exports = {
  async up(db) {
    await db.raw(
      `IF COL_LENGTH('dbo.refresh_tokens','active_role_id') IS NULL
       ALTER TABLE dbo.refresh_tokens ADD active_role_id INT NULL;`
    );
  },

  async down(db) {
    await db.raw(
      `IF COL_LENGTH('dbo.refresh_tokens','active_role_id') IS NOT NULL
       ALTER TABLE dbo.refresh_tokens DROP COLUMN active_role_id;`
    );
  },
};
