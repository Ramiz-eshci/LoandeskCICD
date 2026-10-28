'use strict';

/**
 * Migration: add application_security.map_link (client 02-10-2026).
 *
 * The enquiry Security tab stores a Google Maps link (enquiries/enquiry_security
 * map_link) and shows an embedded map. The application Security & Property tab
 * must mirror the enquiry, so the application's security record needs the same
 * column. Additive + idempotent; carried over on convert.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'application_security', 'map_link', 'map_link NVARCHAR(500) NULL');
  },
  async down(db) {
    await dropCol(db, 'application_security', 'map_link');
  },
};
