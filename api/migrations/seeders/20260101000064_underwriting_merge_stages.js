'use strict';

/**
 * Seeder: merge the underwriting stage permissions to match the new UI
 * (05-10-2026). The screen merged old steps 5-8 (Underwrite & Findings, Credit
 * Discussion, Draft Legal & Credit Paper, Site Visit & Diligence) into ONE step
 * "Underwriting Review". The Roles matrix is collapsed the same way:
 *   - UNDERWRITE_FINDINGS is kept + relabelled "5. Underwriting Review"
 *   - CREDIT_DISCUSSION, DRAFT_LEGAL, SITE_DILIGENCE are merged into it (their
 *     view/edit grants copied over so nobody loses access) and then removed
 *   - the later stages are renumbered 6-8
 * Idempotent.
 */
const PARENT = 'UNDERWRITING_STAGES';
const MERGED = `${PARENT}.UNDERWRITE_FINDINGS`;
const GONE = ['CREDIT_DISCUSSION', 'DRAFT_LEGAL', 'SITE_DILIGENCE'].map((c) => `${PARENT}.${c}`);
const RELABEL = [
  ['UNDERWRITE_FINDINGS', '5. Underwriting Review', 5],
  ['CREDIT_COMMITTEE', '6. Final Credit Committee', 6],
  ['FUNDS_COMPLETION', '7. Funds to Solicitor (Completion)', 7],
  ['COMPLETION_PORTFOLIO', '8. Completion & Move to Portfolio', 8],
];

async function copyGrant(db, fromMod, fromAct, toMod, toAct) {
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT DISTINCT rp.role_id, t.permission_id
       FROM role_permissions rp
       JOIN permissions f ON f.permission_id = rp.permission_id AND f.module_key = @p0 AND f.permission_key = @p1
       JOIN permissions t ON t.module_key = @p2 AND t.permission_key = @p3
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);`,
    [fromMod, fromAct, toMod, toAct]);
}

module.exports = {
  async run(db) {
    // 1) carry the merged-away stages' grants into the kept merged stage
    for (const g of GONE) {
      for (const act of ['view', 'edit']) { await copyGrant(db, g, act, MERGED, act); }
    }
    // 2) relabel + renumber the kept stages
    for (const [code, name, sort] of RELABEL) {
      await db.query('UPDATE modules SET module_name = @p1, sort_order = @p2 WHERE module_code = @p0;',
        [`${PARENT}.${code}`, name, sort]);
    }
    // 3) remove the 3 merged-away stage rows (grants -> permissions -> module)
    for (const g of GONE) {
      await db.query('DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id WHERE p.module_key = @p0;', [g]);
      await db.query('DELETE FROM permissions WHERE module_key = @p0;', [g]);
      await db.query('DELETE FROM modules WHERE module_code = @p0;', [g]);
    }
  },
};
