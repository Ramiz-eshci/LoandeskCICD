'use strict';

/**
 * Seeder: "Underwriting Stages" in the Roles matrix — one row per stage the
 * underwriting screen shows (10 stages), each with VIEW + EDIT:
 *   view -> can open the stage and see its data
 *   edit -> can work the stage (save / complete / decide)
 * (Step 1 "Initial Review" is the case acceptance -> UNDERWRITING.CASE.accept.)
 *
 * Also removes from the matrix:
 *   - UNDERWRITING_WORK_QUEUE           (unused)
 *   - UNDERWIRTING_WORKFLOW_CHECKLIST.* (old checklist rows, replaced by the stages)
 *
 * Grants on the new stage rows:
 *   a) baseline = the old fixed step roles (by role_id)
 *   b) PLUS whatever the old checklist permission that gated the step was granted
 *      to (so nobody loses what they have today)
 *   c) view = every role holding UNDERWRITING.CASE.view (today everyone who can
 *      open a case sees every stage) + every role with edit on that stage.
 * Then the old rows are deleted. Idempotent.
 */

const PARENT = 'UNDERWRITING_STAGES';

// [code suffix, display name, sort, baseline edit role ids, old gating [module, action]]
// Client 08-10-2026: the "Requirements to Broker" stage is removed (requirements are
// now sent from a button at the top of the case, not a workflow step). Stages are
// renumbered 1..10 and ordered to match the screen (Solicitor Quote before KYC / AML).
const STAGES = [
  ['VALUATION_INSTRUCTION', '1. Valuation Instruction', 1, [1, 3, 13], ['VALUATION', 'edit']],
  ['SOLICITOR_QUOTE', '2. Solicitor Quote', 2, [1, 3, 6], ['BORROWER_SOLICITOR_CHECKS', 'edit']],
  ['KYC_AML', '3. KYC / AML', 3, [1, 3], ['KYC_AML', 'edit']],
  ['UNDERWRITE_FINDINGS', '4. Underwrite & Findings', 4, [1, 3, 4], ['UNDERWRITING_ASSESSMENT', 'edit']],
  ['CREDIT_DISCUSSION', '5. Credit Discussion', 5, [1, 3, 4], ['CREDIT_BACKGROUND_CHECKS', 'edit']],
  ['DRAFT_LEGAL', '6. Draft Legal Documents & Credit Paper', 6, [1, 3, 5], ['LEGAL', 'edit']],
  ['SITE_DILIGENCE', '7. Site Visit & Solicitor Diligence', 7, [1, 3, 6], ['SECURITY_PROPERTY_REVIEW', 'edit']],
  ['CREDIT_COMMITTEE', '8. Final Credit Committee', 8, [1, 4], ['SECTION_PASS_FINAL_APPROVAL', 'approve']],
  ['FUNDS_COMPLETION', '9. Funds to Solicitor (Completion)', 9, [1, 3], ['SECTION_PASS_FINAL_APPROVAL', 'edit']],
  ['COMPLETION_PORTFOLIO', '10. Completion & Move to Portfolio', 10, [1, 3], ['SECTION_PASS_FINAL_APPROVAL', 'edit']],
];
const OLD = 'UNDERWIRTING_WORKFLOW_CHECKLIST';

async function grant(db, roleId, mod, act) {
  await db.query(
    `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key=@p1 AND permission_key=@p2);
     IF @p IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE role_id=@p0)
        AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@p0 AND permission_id=@p)
       INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
    [roleId, mod, act],
  );
}

/** Give (toMod,toAct) to every role that holds (fromMod,fromAct). */
async function copyGrant(db, fromMod, fromAct, toMod, toAct) {
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT DISTINCT rp.role_id, t.permission_id
       FROM role_permissions rp
       JOIN permissions f ON f.permission_id = rp.permission_id AND f.module_key = @p0 AND f.permission_key = @p1
       JOIN permissions t ON t.module_key = @p2 AND t.permission_key = @p3
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);`,
    [fromMod, fromAct, toMod, toAct],
  );
}

module.exports = {
  async run(db) {
    // 1) group header + stage rows
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code=@p0)
         INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, N'Underwriting Stages', NULL, 31);
       ELSE UPDATE modules SET module_name=N'Underwriting Stages', parent_code=NULL, sort_order=31 WHERE module_code=@p0;`,
      [PARENT],
    );
    for (const [code, name, sort] of STAGES) {
      const mod = `${PARENT}.${code}`;
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code=@p0)
           INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, @p1, @p2, @p3);
         ELSE UPDATE modules SET module_name=@p1, parent_code=@p2, sort_order=@p3 WHERE module_code=@p0;`,
        [mod, name, PARENT, sort],
      );
      for (const act of ['view', 'edit']) {
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
             INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
          [mod, act, `${act} ${mod}`],
        );
      }
    }

    // 2) grants
    for (const [code, , , roles, [oldMod, oldAct]] of STAGES) {
      const mod = `${PARENT}.${code}`;
      for (const r of roles) { await grant(db, r, mod, 'edit'); }            // a) baseline
      await copyGrant(db, `${OLD}.${oldMod}`, oldAct, mod, 'edit');          // b) keep today's access
      await copyGrant(db, 'UNDERWRITING.CASE', 'view', mod, 'view');         // c) view
      await copyGrant(db, mod, 'edit', mod, 'view');
    }

    // 3) remove retired rows (grants first — FK)
    await db.raw(`
      DELETE rp FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE p.module_key = 'UNDERWRITING_WORK_QUEUE'
          OR p.module_key = '${OLD}' OR p.module_key LIKE '${OLD}.%';
      DELETE FROM permissions
       WHERE module_key = 'UNDERWRITING_WORK_QUEUE'
          OR module_key = '${OLD}' OR module_key LIKE '${OLD}.%';
      DELETE FROM modules
       WHERE module_code = 'UNDERWRITING_WORK_QUEUE'
          OR module_code = '${OLD}' OR module_code LIKE '${OLD}.%';`);
  },
};
