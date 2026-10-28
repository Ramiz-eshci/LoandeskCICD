'use strict';

/**
 * Seeder: DYNAMIC modules + permissions + role→permission matrix, generated from
 * the LoanDesk modules sheet (loandesk_matrix.json).
 *
 *  - modules master: full module/screen hierarchy (parent_code links).
 *  - permissions: one row per (module_code, action) actually used by any role.
 *  - role_permissions: additive grants per the sheet's role matrix (non-destructive;
 *    existing coarse grants from earlier seeders are preserved).
 *  - adds the 'Head Sales' role (role_id 12) present in the sheet.
 *
 * Idempotent: every insert is guarded. Re-running only fills gaps.
 */

const data = require('./loandesk_matrix.json');

// Sheet modules retired from the Roles matrix — never (re)seeded:
//  - UNDERWRITING_WORK_QUEUE (unused; the Underwriting screen uses UNDERWRITING.CASE)
//  - UNDERWIRTING_WORKFLOW_CHECKLIST.* (replaced by UNDERWRITING_STAGES.*, one row per stage)
const RETIRED = (code) => code === 'UNDERWRITING_WORK_QUEUE'
  || code === 'UNDERWIRTING_WORKFLOW_CHECKLIST' || String(code).startsWith('UNDERWIRTING_WORKFLOW_CHECKLIST.');

module.exports = {
  async run(db) {
    // 1) Head Sales role at a fixed id (sheet has 11 role columns; core seed had 10).
    await db.raw(
      'SET IDENTITY_INSERT dbo.roles ON;\n' +
        "IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id=12) INSERT INTO roles (role_id, role_name) VALUES (12, N'Head Sales');\n" +
        'SET IDENTITY_INSERT dbo.roles OFF;',
    );

    // 2) modules master
    for (const m of data.modules) {
      if (RETIRED(m.code)) continue;
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code=@p0)
           INSERT INTO modules (module_code, module_name, parent_code, sort_order)
           VALUES (@p0, @p1, @p2, @p3);`,
        [m.code, m.name, m.parent || null, m.sort || 0],
      );
    }

    // 3) permission catalog: unique (module_code, action) across the whole matrix
    const permSet = new Set();
    for (const role of Object.keys(data.grants)) {
      const byModule = data.grants[role];
      for (const code of Object.keys(byModule)) {
        if (RETIRED(code)) continue;
        for (const act of byModule[code]) permSet.add(code + '|' + String(act).toLowerCase());
      }
    }
    for (const key of permSet) {
      const idx = key.indexOf('|');
      const code = key.slice(0, idx);
      const act = key.slice(idx + 1);
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
           INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
        [code, act, act + ' ' + code],
      );
    }

    // 4) role_permissions from the sheet matrix (additive)
    for (const role of Object.keys(data.grants)) {
      const byModule = data.grants[role];
      for (const code of Object.keys(byModule)) {
        if (RETIRED(code)) continue;
        for (const rawAct of byModule[code]) {
          const act = String(rawAct).toLowerCase();
          await db.query(
            `DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p0);
             DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key=@p1 AND permission_key=@p2);
             IF @r IS NOT NULL AND @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@r AND permission_id=@p)
               INSERT INTO role_permissions (role_id, permission_id) VALUES (@r, @p);`,
            [role, code, act],
          );
        }
      }
    }
  },
};
