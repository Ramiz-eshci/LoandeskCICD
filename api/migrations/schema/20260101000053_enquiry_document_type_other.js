'use strict';

/**
 * Migration: free-text document type for enquiry uploads (client 01-10-2026).
 * When the uploader picks "Others", the typed label is stored in
 * enquiry_documents.type_other and shown as the document type (COALESCE with the
 * master document_types.name). Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'enquiry_documents', 'type_other', 'type_other NVARCHAR(100) NULL');
  },
  async down(db) {
    await dropCol(db, 'enquiry_documents', 'type_other');
  },
};
