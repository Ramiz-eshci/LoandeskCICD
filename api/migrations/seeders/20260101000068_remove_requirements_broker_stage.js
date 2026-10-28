'use strict';

/**
 * Seeder: remove the "Requirements to Broker" underwriting stage (client 08-10-2026).
 *
 * The whole Requirements-to-Broker step is gone — the underwriter now sends the
 * requirements from a button at the top of the case (broker when there is one,
 * otherwise the applicant(s); a company's directors each get their own e-mail).
 *
 * This seeder:
 *   1) deletes the UNDERWRITING_STAGES.REQUIREMENTS_BROKER role grants, permissions
 *      and module row from the Roles matrix;
 *   2) marks any EXISTING case's step 5 (requirements_broker) as Skipped so the
 *      "all steps complete before Portfolio" gate is not blocked by the retired step.
 *
 * Idempotent and additive-safe (nothing to do once already applied).
 */

module.exports = {
  async run(db) {
    // 1) drop the stage from the Roles matrix (grants first — FK).
    await db.raw(`
      DELETE rp FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE p.module_key = 'UNDERWRITING_STAGES.REQUIREMENTS_BROKER';
      DELETE FROM permissions WHERE module_key = 'UNDERWRITING_STAGES.REQUIREMENTS_BROKER';
      DELETE FROM modules WHERE module_code = 'UNDERWRITING_STAGES.REQUIREMENTS_BROKER';`);

    // 2) retire the leftover step on existing cases so it never blocks completion.
    await db.query(
      `UPDATE underwriting_steps
          SET status = 'Skipped', completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
        WHERE step_no = 5 AND step_key = 'requirements_broker'
          AND status NOT IN ('Completed', 'Approved', 'Skipped');`);
  },
};
