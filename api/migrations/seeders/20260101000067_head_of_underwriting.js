'use strict';

/**
 * Seeder: "Head of Underwriting" permission (client 08-10-2026).
 *
 *   UNDERWRITING.HEAD_OF_UNDERWRITING  view  (Roles › Underwriting › Head of Underwriting)
 *     Users whose role holds it are e-mailed the final Credit Deal Summary when the
 *     "Send Credit Paper to Committee" button is used on the Final Credit Committee
 *     step (services/underwriting.service.js -> dealSummary.headOfUnderwritingUsers()).
 *
 * Mirrors APPLICATIONS.HEAD_OF_APPLICATION. No role gets it by default — tick it in
 * Roles for whoever should receive the final credit paper. Additive and idempotent.
 */

module.exports = {
  async run(db) {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'UNDERWRITING.HEAD_OF_UNDERWRITING')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order)
         VALUES ('UNDERWRITING.HEAD_OF_UNDERWRITING', N'Head of Underwriting', 'UNDERWRITING', 24);
       ELSE
         UPDATE modules SET module_name = N'Head of Underwriting', parent_code = 'UNDERWRITING'
          WHERE module_code = 'UNDERWRITING.HEAD_OF_UNDERWRITING';`);
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'UNDERWRITING.HEAD_OF_UNDERWRITING' AND permission_key = 'view')
         INSERT INTO permissions (module_key, permission_key, description)
         VALUES ('UNDERWRITING.HEAD_OF_UNDERWRITING', 'view', 'Receives the final Credit Deal Summary e-mail from the Final Credit Committee step');`);
  },
};
