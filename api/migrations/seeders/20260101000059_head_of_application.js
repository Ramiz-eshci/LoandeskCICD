'use strict';

/**
 * Seeder: "Head of Application" permission + "Credit Deal Summary" document type
 * (client 29-09-2026).
 *
 *   APPLICATIONS.HEAD_OF_APPLICATION  view  (Roles › Applications › Head of Application)
 *     Users whose role holds it are e-mailed the Credit Deal Summary PDF each time an
 *     enquiry is converted into an application (services/dealSummary.service.js).
 *   document_types DEAL_SUMMARY  - the type the summary is saved under on the application.
 *
 * No role gets it by default: tick it in Roles for the bosses who should receive it.
 * Additive and idempotent.
 */

module.exports = {
  async run(db) {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'APPLICATIONS.HEAD_OF_APPLICATION')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order)
         VALUES ('APPLICATIONS.HEAD_OF_APPLICATION', N'Head of Application', 'APPLICATIONS', 2);
       ELSE
         UPDATE modules SET module_name = N'Head of Application', parent_code = 'APPLICATIONS'
          WHERE module_code = 'APPLICATIONS.HEAD_OF_APPLICATION';`);
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key = 'APPLICATIONS.HEAD_OF_APPLICATION' AND permission_key = 'view')
         INSERT INTO permissions (module_key, permission_key, description)
         VALUES ('APPLICATIONS.HEAD_OF_APPLICATION', 'view', 'Receives the Credit Deal Summary e-mail when an enquiry is converted to an application');`);
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM document_types WHERE code = 'DEAL_SUMMARY')
         INSERT INTO document_types (code, name, category) VALUES ('DEAL_SUMMARY', 'Credit Deal Summary', 'Application');`);
  },
};
