'use strict';

/**
 * Seeder: Enquiry module permission matrix v2 (per LoanDesk enquiry RBAC sheet).
 *
 * Restructures ENQUIRIES into granular screens, each with its own action set:
 *   ENQUIRY_LIST         Add Edit Delete View Assign Reject Export
 *   ENQUIRY_EMAIL        Add Edit Delete View Assign Reject Export   (Email Capture)
 *   ALL_ENQUIRIES        Add Edit Delete View Assign Reject          (view => see every enquiry, not just assigned)
 *   REQUEST_INFO         Add Edit Delete View
 *   OFFER                Add Edit Delete View Reject
 *   DOCUMENTS_UPLOAD     Add Edit Delete View
 *   SUBMIT_TO_APPLICATION           Edit        Assign
 *
 * Grants are keyed by ROLE_ID (fixed ids from core_rbac), NOT role_name — so a
 * role rename never orphans its grants (unlike loandesk_matrix.json). Idempotent:
 * every insert is guarded; re-running only fills gaps.
 */

const MODULES = [
  // code, name, sort   (parent is always ENQUIRIES)
  ['ENQUIRIES.ENQUIRY_LIST', 'Enquiries List', 13],
  ['ENQUIRIES.ENQUIRY_EMAIL', 'Email Capture', 14],
  ['ENQUIRIES.ALL_ENQUIRIES', 'All Enquiries', 15],
  ['ENQUIRIES.REQUEST_INFO', 'Request Info', 16],
  ['ENQUIRIES.OFFER', 'Offer', 17],
  ['ENQUIRIES.DOCUMENTS_UPLOAD', 'Documents Upload', 18],
  ['ENQUIRIES.SUBMIT_TO_APPLICATION', 'Submit to Application', 19],
];

// module_code -> allowed actions (lowercase = stored form)
const PERMS = {
  'ENQUIRIES.ENQUIRY_LIST': ['add', 'edit', 'delete', 'view', 'assign', 'reject', 'export'],
  'ENQUIRIES.ENQUIRY_EMAIL': ['add', 'edit', 'delete', 'view', 'assign', 'reject', 'export'],
  'ENQUIRIES.ALL_ENQUIRIES': ['add', 'edit', 'delete', 'view', 'assign', 'reject'],
  'ENQUIRIES.REQUEST_INFO': ['add', 'edit', 'delete', 'view'],
  'ENQUIRIES.OFFER': ['add', 'edit', 'delete', 'view', 'reject'],
  'ENQUIRIES.DOCUMENTS_UPLOAD': ['add', 'edit', 'delete', 'view'],
  'ENQUIRIES.SUBMIT_TO_APPLICATION': ['edit', 'assign'],
};

// Baseline grants by ROLE_ID (fixed ids). Admin refines the rest in the Roles UI.
//  - role 1 = System Administrator: full enquiry catalog (also bypasses RBAC, but shown ticked).
//  - ALL_ENQUIRIES.view (= "see every enquiry") migrated to the same roles that held the
//    earlier ENQUIRY_LIST.view_all: 1 SysAdmin, 3 Underwriter, 4 Credit Mgr, 8 Branch Mgr,
//    10 Auditor, 12 Head Sales. NOT role 2 (Sales/BDM) -> stays assigned-only.
const SEE_ALL_ROLE_IDS = [1, 3, 4, 8, 10, 12];

module.exports = {
  async run(db) {
    // 1) modules — insert new, and normalise display names of the two that already exist
    for (const [code, name, sort] of MODULES) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code=@p0)
           INSERT INTO modules (module_code, module_name, parent_code, sort_order)
           VALUES (@p0, @p1, 'ENQUIRIES', @p2);
         ELSE
           UPDATE modules SET module_name=@p1, parent_code='ENQUIRIES', sort_order=@p2 WHERE module_code=@p0;`,
        [code, name, sort],
      );
    }

    // 2) permission catalog — one row per (module, action)
    for (const code of Object.keys(PERMS)) {
      for (const act of PERMS[code]) {
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
             INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
          [code, act, act + ' ' + code],
        );
      }
    }

    // 3a) full enquiry catalog -> System Administrator (role_id 1), by id
    for (const code of Object.keys(PERMS)) {
      for (const act of PERMS[code]) {
        await db.query(
          `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key=@p1 AND permission_key=@p2);
           IF @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@p0 AND permission_id=@p)
             INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
          [1, code, act],
        );
      }
    }

    // 3b) ALL_ENQUIRIES.view (see-all scope) -> migrated role ids, by id
    for (const rid of SEE_ALL_ROLE_IDS) {
      await db.query(
        `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key='ENQUIRIES.ALL_ENQUIRIES' AND permission_key='view');
         IF @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@p0 AND permission_id=@p)
           INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
        [rid],
      );
    }
  },
};
