'use strict';

/**
 * Migration: extension fees Upfront / Retained (client 28-10-2026).
 *
 *   Retained fee  -> added to the facility's GROSS loan + outstanding when the extension is
 *                    approved (net unchanged); interest for the extension months is worked on
 *                    the new gross. The fee row is kept on the facility as 'Capitalised'.
 *   Upfront fee   -> separate charge (status Due) the borrower pays; marked Paid from the
 *                    extension's payment schedule (or the facility's Fees). The extension only
 *                    leaves "Awaiting Fees" once every upfront fee is paid (completed_at).
 *
 *   portfolio_extensions.gross_after     gross once retained fees are added
 *   portfolio_extensions.retained_fees   total of the fees retained into the gross
 *   portfolio_extensions.completed_at    approved AND every upfront fee paid
 *   loan_fees.extension_id               fee raised by an extension
 *   loan_fees.paid_on / paid_method / paid_reference / paid_by / paid_at   payment record
 *
 * Existing approved extensions are treated as complete (they were never gated) and their
 * fee rows are linked by the "– EXT-000123" note they were raised with. Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

const EXT_COLS = [
  ['gross_after', 'gross_after DECIMAL(18,2) NULL'],
  ['retained_fees', 'retained_fees DECIMAL(18,2) NULL'],
  ['completed_at', 'completed_at DATETIME2 NULL'],
];
const FEE_COLS = [
  ['extension_id', 'extension_id INT NULL'],
  ['paid_on', 'paid_on DATE NULL'],
  ['paid_method', 'paid_method NVARCHAR(30) NULL'],
  ['paid_reference', 'paid_reference NVARCHAR(80) NULL'],
  ['paid_by', 'paid_by INT NULL'],
  ['paid_at', 'paid_at DATETIME2 NULL'],
];

module.exports = {
  async up(db) {
    for (const [col, ddl] of EXT_COLS) await addCol(db, 'portfolio_extensions', col, ddl);
    for (const [col, ddl] of FEE_COLS) await addCol(db, 'loan_fees', col, ddl);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_fee_extension')
      CREATE INDEX IX_fee_extension ON dbo.loan_fees(extension_id);`);
    // Backfill (separate batches: the new columns must exist before they are referenced).
    await db.raw(`
      UPDATE f SET f.extension_id = x.extension_id
        FROM dbo.loan_fees f
        JOIN dbo.portfolio_extensions x ON x.loan_id = f.loan_id AND x.extension_ref IS NOT NULL
       WHERE f.extension_id IS NULL AND f.fee_type IN ('Extension', 'Document')
         AND f.notes LIKE '%' + x.extension_ref + '%';`);
    await db.raw(`
      UPDATE dbo.portfolio_extensions
         SET completed_at = COALESCE(applied_at, decided_at, SYSUTCDATETIME())
       WHERE status = 'Approved' AND completed_at IS NULL;`);
    await db.raw(`
      UPDATE dbo.portfolio_extensions SET gross_after = gross_amount, retained_fees = 0
       WHERE gross_after IS NULL;`);
  },

  async down(db) {
    await db.raw("IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_fee_extension') DROP INDEX IX_fee_extension ON dbo.loan_fees;");
    for (const [col] of FEE_COLS) await dropCol(db, 'loan_fees', col);
    for (const [col] of EXT_COLS) await dropCol(db, 'portfolio_extensions', col);
  },
};
