'use strict';

/**
 * Migration: profile picture on the user (client 26-10-2026).
 *   avatar   small resized image as a data URL (png / jpeg / webp, <= ~300 KB) shown in the
 *            header + sidebar instead of the initials. NULL = initials.
 * Additive + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.users','avatar') IS NULL ALTER TABLE dbo.users ADD avatar NVARCHAR(MAX) NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.users','avatar') IS NOT NULL ALTER TABLE dbo.users DROP COLUMN avatar;`);
  },
};
