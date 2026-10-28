'use strict';

/**
 * Seed valuer_firms (Surveyor / Valuer master) with the Figma panel firms, and
 * align valuation_types to the Figma Valuation Instruction list (adds missing
 * ones, activates them). Idempotent — guarded by unique code.
 */

module.exports = {
  async run(db) {
    // --- Valuer / Surveyor firms (Figma panel) ---
    const firms = [
      { code: 'KNIGHTFRANK', name: 'Knight Frank LLP', firm: 'Knight Frank LLP' },
      { code: 'SAVILLS', name: 'Savills', firm: 'Savills plc' },
      { code: 'CBRE', name: 'CBRE', firm: 'CBRE Ltd' },
      { code: 'JLL', name: 'JLL', firm: 'Jones Lang LaSalle' },
      { code: 'ALLSOP', name: 'Allsop', firm: 'Allsop LLP' },
    ];
    for (const f of firms) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM valuer_firms WHERE code=@p0)
           INSERT INTO valuer_firms (code, name, firm) VALUES (@p0, @p1, @p2);
         ELSE
           UPDATE valuer_firms SET name=@p1, firm=@p2, is_active=1, flag_deleted=0 WHERE code=@p0;`,
        [f.code, f.name, f.firm],
      );
    }

    // --- Valuation types: match Figma Valuation Instruction dropdown ---
    const vtypes = [
      { code: 'RICS_REDBOOK', name: 'RICS Red Book' },
      { code: 'DEV_APPRAISAL', name: 'Development Appraisal' },
      { code: 'DESKTOP', name: 'Desktop' },
      { code: 'AVM', name: 'AVM' },
      { code: 'VAS_FULL', name: 'VAS — Full Valuation' },
    ];
    for (const t of vtypes) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM valuation_types WHERE code=@p0)
           INSERT INTO valuation_types (code, name) VALUES (@p0, @p1);
         ELSE
           UPDATE valuation_types SET name=@p1, is_active=1, flag_deleted=0 WHERE code=@p0;`,
        [t.code, t.name],
      );
    }
    // retire legacy seed types not in the Figma list (keep data, hide from dropdown)
    await db.query(
      `UPDATE valuation_types SET is_active=0
        WHERE code IN ('FULL','DRIVEBY') AND code NOT IN ('RICS_REDBOOK','DEV_APPRAISAL','DESKTOP','AVM','VAS_FULL');`,
    );
  },
};
