'use strict';

/**
 * Migration: add the dedicated Security / Property fields to enquiries
 * (client PDF section 3). Additive & idempotent.
 *
 * estimated_value (already present) = Current Value.
 * property_address (already present) = Property Address.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(
    `IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`,
  );
}

module.exports = {
  async up(db) {
    await addCol(db, 'enquiries', 'postcode', 'postcode NVARCHAR(20) NULL');
    await addCol(db, 'enquiries', 'property_type', 'property_type NVARCHAR(80) NULL');
    await addCol(db, 'enquiries', 'tenure', 'tenure NVARCHAR(20) NULL');           // Freehold / Leasehold
    await addCol(db, 'enquiries', 'tenure_years', 'tenure_years INT NULL');        // remaining lease years
    await addCol(db, 'enquiries', 'charge_type', 'charge_type NVARCHAR(20) NULL'); // 1st / 2nd
    await addCol(db, 'enquiries', 'gdv', 'gdv DECIMAL(18,2) NULL');
    await addCol(db, 'enquiries', 'owns_property', 'owns_property BIT NULL');
    await addCol(db, 'enquiries', 'purchase_price', 'purchase_price DECIMAL(18,2) NULL');
    await addCol(db, 'enquiries', 'purchase_date', 'purchase_date DATE NULL');
    await addCol(db, 'enquiries', 'outstanding_loan', 'outstanding_loan DECIMAL(18,2) NULL');
    await addCol(db, 'enquiries', 'repaid_on_completion', 'repaid_on_completion BIT NULL');
    await addCol(db, 'enquiries', 'lender', 'lender NVARCHAR(150) NULL');
    await addCol(db, 'enquiries', 'added_value', 'added_value NVARCHAR(MAX) NULL');
  },

  async down(db) {
    const cols = ['postcode','property_type','tenure','tenure_years','charge_type','gdv',
      'owns_property','purchase_price','purchase_date','outstanding_loan',
      'repaid_on_completion','lender','added_value'];
    for (const c of cols) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
  },
};
