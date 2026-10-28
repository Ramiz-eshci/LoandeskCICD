'use strict';

/**
 * Seeder: RBAC modules v3 — makes the Roles matrix the single source of truth
 * for the screens that were still hard-wired or hidden.
 *
 *  1) APPLICATIONS.ALL_APPLICATIONS (view)  -> "see every application".
 *     Without it a user sees only applications assigned to them (BDM /
 *     underwriter / credit manager). Baseline = the same roles that see all
 *     enquiries: 1 SysAdmin, 3 Underwriter, 4 Credit Mgr, 8 Branch Mgr,
 *     10 Auditor, 12 Head Sales. NOT 2 Sales/BDM (assigned-only).
 *
 *  2) CREDIT / VALUATION / LEGAL as their OWN top-level modules in the matrix
 *     (separate from underwriting). CREDIT + LEGAL permission rows already
 *     existed (master_data seeder) but had no `modules` row, so the Roles
 *     screen could not show / grant them. VALUATION is new (view / edit).
 *
 *  3) (moved) Underwriting stage permissions now live in seeder
 *     20260101000046_underwriting_stages (UNDERWRITING_STAGES.*). Was: each
 *     workflow step is now gated on its checklist permission (see
 *     config/underwriting.config.js `perm`). The grants below reproduce the old
 *     hard-coded step role lists so nobody loses access on deploy.
 *
 * Grants keyed by ROLE_ID (rename-safe). Idempotent: guarded inserts only.
 */

const ROLE = {
  SYS_ADMIN: 1, SALES_BDM: 2, UNDERWRITER: 3, CREDIT_MGR: 4, LEGAL: 5, SOLICITOR: 6,
  PORTFOLIO: 7, BRANCH_MGR: 8, COLLECTION: 9, AUDITOR: 10, HEAD_SALES: 12,
  VALUATION_USER: 13, BROKER: 14,
};

// [code, name, parent, sort]
const MODULES = [
  ['APPLICATIONS.ALL_APPLICATIONS', 'All Applications', 'APPLICATIONS', 23],
  ['VALUATION', 'Valuations', null, 33],
  ['CREDIT', 'Credit', null, 35],
  ['LEGAL', 'Legal & Completion', null, 37],
];

// module_key -> actions (permission catalogue)
const PERMS = {
  'APPLICATIONS.ALL_APPLICATIONS': ['view'],
  VALUATION: ['view', 'edit'],
  CREDIT: ['view', 'approve', 'reject'],
  LEGAL: ['view', 'edit'],
  'UNDERWRITING.CASE': ['act'],
};

// [module_key, action, [role ids]]
const GRANTS = [
  // 1) see-all applications
  ['APPLICATIONS.ALL_APPLICATIONS', 'view', [1, 3, 4, 8, 10, 12]],

  // 2) credit / valuation / legal screens
  ['VALUATION', 'view', [1, 3, 4, 10, 13]],
  ['VALUATION', 'edit', [1, 3, 13]],
  ['CREDIT', 'view', [1, 4, 10]],
  ['CREDIT', 'approve', [1, 4]],
  ['CREDIT', 'reject', [1, 4]],
  ['LEGAL', 'view', [1, 5, 6, 10]],
  ['LEGAL', 'edit', [1, 5, 6]],

  // Legal role works step 8, so it needs the coarse route action too
  ['UNDERWRITING.CASE', 'act', [5]],
];

module.exports = {
  ROLE,
  async run(db) {
    // 1) modules
    for (const [code, name, parent, sort] of MODULES) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code=@p0)
           INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, @p1, @p2, @p3);
         ELSE
           UPDATE modules SET module_name=@p1, parent_code=@p2, sort_order=@p3 WHERE module_code=@p0;`,
        [code, name, parent, sort],
      );
    }

    // 2) permission catalogue
    for (const mod of Object.keys(PERMS)) {
      for (const act of PERMS[mod]) {
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
             INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
          [mod, act, act + ' ' + mod],
        );
      }
    }

    // 3) grants by role_id (skip roles that do not exist)
    for (const [mod, act, roleIds] of GRANTS) {
      for (const roleId of roleIds) {
        await db.query(
          `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key=@p1 AND permission_key=@p2);
           IF @p IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE role_id=@p0)
              AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@p0 AND permission_id=@p)
             INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
          [roleId, mod, act],
        );
      }
    }
  },
};
