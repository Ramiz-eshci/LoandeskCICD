'use strict';

/**
 * Migration: store Lead Source as a master FK on enquiries (client 01-10-2026).
 *
 * Previously enquiries.lead_source held the Lead Source NAME as free text, so
 * renaming a Lead Source master row never updated existing enquiries. Add
 * enquiries.lead_source_id (int, matches lead_sources.lead_source_id) and
 * backfill it by matching the old text to lead_sources.name. The enquiry detail
 * API now returns COALESCE(ls.name, e.lead_source), so renames propagate while
 * the legacy text column is kept as a fallback (not dropped). Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'enquiries', 'lead_source_id', 'lead_source_id INT NULL');
    // Backfill the new id from the existing free-text name (trimmed match).
    await db.raw(`
      UPDATE e SET e.lead_source_id = ls.lead_source_id
        FROM dbo.enquiries e
        JOIN dbo.lead_sources ls
          ON LTRIM(RTRIM(ls.name)) = LTRIM(RTRIM(e.lead_source))
         AND ls.flag_deleted = 0
       WHERE e.lead_source_id IS NULL
         AND e.lead_source IS NOT NULL
         AND e.lead_source <> '';`);
  },
  async down(db) {
    await dropCol(db, 'enquiries', 'lead_source_id');
  },
};
