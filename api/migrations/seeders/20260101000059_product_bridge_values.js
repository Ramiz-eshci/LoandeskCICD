'use strict';

/**
 * Seeder: Product master -> bridging product set; Loan Purpose master gets
 * "Rebridge" and "Development Exit" (29-09-2026).
 *
 * Product master — the ONLY active products are now:
 *   BRIDGE-1ST      1st Charge Bridge
 *   BRIDGE-2ND      2nd Charge Bridge
 *   BRIDGE-1ST-2ND  1st and 2nd Charge Bridge
 *   BRIDGE-MULTI    Multi Bridge
 * (all under product type BRDG / Bridging).
 *
 * Every other product (RES-MTG, BRDG-STD, DEV-FIN, BTL-STD, BRIDGE-LOAN and any
 * row added by hand) is retired:
 *   1. every foreign key that points at an old product (enquiries,
 *      applications, rates, ... — found from sys.foreign_keys, so new tables
 *      are covered automatically) is repointed to BRIDGE-1ST, so no existing
 *      record is left on a product the dropdowns no longer offer;
 *   2. the old product rows are soft-deleted (is_active = 0, flag_deleted = 1).
 *      No row is hard-deleted.
 *
 * Loan Purpose master — adds REBRIDGE "Rebridge" and DEV_EXIT
 * "Development Exit" (guarded by code OR name; re-activated if soft-deleted).
 *
 * Idempotent: safe to run again (every step is a no-op once applied).
 */
const NEW_PRODUCTS = [
  ['BRIDGE-1ST', '1st Charge Bridge'],
  ['BRIDGE-2ND', '2nd Charge Bridge'],
  ['BRIDGE-1ST-2ND', '1st and 2nd Charge Bridge'],
  ['BRIDGE-MULTI', 'Multi Bridge'],
];
const DEFAULT_PRODUCT = 'BRIDGE-1ST';

const NEW_PURPOSES = [
  ['REBRIDGE', 'Rebridge'],
  ['DEV_EXIT', 'Development Exit'],
];

module.exports = {
  async run(db) {
    /* ---------- 0) Bridging product type ---------- */
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM product_types WHERE code = 'BRDG')
         INSERT INTO product_types (code, name) VALUES ('BRDG', 'Bridging');`,
    );

    /* ---------- 1) upsert the 4 new products ---------- */
    for (const [code, name] of NEW_PRODUCTS) {
      await db.query(
        `DECLARE @pt INT = (SELECT TOP 1 product_type_id FROM product_types WHERE code = 'BRDG');
         IF NOT EXISTS (SELECT 1 FROM products WHERE code = @p0)
           INSERT INTO products (code, name, product_type_id, is_active, flag_deleted)
           VALUES (@p0, @p1, @pt, 1, 0);
         ELSE
           UPDATE products
              SET name = @p1, product_type_id = @pt, is_active = 1, flag_deleted = 0,
                  deleted_on = NULL, updated_at = SYSUTCDATETIME()
            WHERE code = @p0;`,
        [code, name],
      );
    }

    /* ---------- 2) repoint every FK reference of an old product ---------- */
    const keep = NEW_PRODUCTS.map(([c]) => c);
    const inList = keep.map((_, i) => '@p' + (i + 1)).join(', ');
    await db.query(
      `DECLARE @new INT = (SELECT product_id FROM products WHERE code = @p0);
       DECLARE @old TABLE (product_id INT PRIMARY KEY);
       INSERT INTO @old (product_id)
         SELECT product_id FROM products WHERE code NOT IN (${inList});

       IF @new IS NOT NULL AND EXISTS (SELECT 1 FROM @old)
       BEGIN
         DECLARE @oldIds NVARCHAR(MAX) =
           STUFF((SELECT ',' + CAST(product_id AS NVARCHAR(20)) FROM @old FOR XML PATH('')), 1, 1, '');
         DECLARE @sql NVARCHAR(MAX) = N'';
         SELECT @sql = @sql +
                N'UPDATE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) +
                N' SET ' + QUOTENAME(c.name) + N' = ' + CAST(@new AS NVARCHAR(20)) +
                N' WHERE ' + QUOTENAME(c.name) + N' IN (' + @oldIds + N');' + CHAR(10)
           FROM sys.foreign_key_columns fkc
           JOIN sys.tables  t ON t.object_id = fkc.parent_object_id
           JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
          WHERE fkc.referenced_object_id = OBJECT_ID('dbo.products');
         IF LEN(@sql) > 0 EXEC sp_executesql @sql;
       END`,
      [DEFAULT_PRODUCT, ...keep],
    );

    /* ---------- 3) soft-delete the old products ---------- */
    await db.query(
      `UPDATE products
          SET is_active = 0, flag_deleted = 1,
              deleted_on = COALESCE(deleted_on, SYSUTCDATETIME()), updated_at = SYSUTCDATETIME()
        WHERE code NOT IN (${keep.map((_, i) => '@p' + i).join(', ')})
          AND (is_active = 1 OR flag_deleted = 0);`,
      keep,
    );

    /* ---------- 4) Loan Purpose: Rebridge + Development Exit ---------- */
    for (const [code, name] of NEW_PURPOSES) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM loan_purposes WHERE code = @p0 OR name = @p1)
           INSERT INTO loan_purposes (code, name, is_active, flag_deleted) VALUES (@p0, @p1, 1, 0);
         ELSE
           UPDATE loan_purposes
              SET is_active = 1, flag_deleted = 0, deleted_on = NULL, updated_at = SYSUTCDATETIME()
            WHERE code = @p0 OR name = @p1;`,
        [code, name],
      );
    }
  },
};
