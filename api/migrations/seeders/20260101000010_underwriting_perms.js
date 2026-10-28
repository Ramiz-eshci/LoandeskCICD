'use strict';

/**
 * Seeder: Underwriting module (Module-6) roles + permissions, keyed by ROLE_ID
 * (rename-safe — never by role_name, unlike loandesk_matrix.json).
 *
 * Adds the two workflow login roles the underwriting matrix needs that the core
 * seed lacks: Valuation User (13), Broker (14). Then seeds UNDERWRITING.CASE
 * permissions and grants them per role.
 */

const ROLE = {
  SYS_ADMIN: 1, UNDERWRITER: 3, CREDIT_MGR: 4, LEGAL: 5, SOLICITOR: 6,
  PORTFOLIO: 7, VALUATION_USER: 13, BROKER: 14,
};

// action catalogue on UNDERWRITING.CASE
const ACTIONS = ['view', 'accept', 'act', 'decide', 'query', 'respond', 'reject', 'assign'];

// grants by role_id -> actions
const GRANTS = {
  [ROLE.SYS_ADMIN]: ACTIONS,
  [ROLE.UNDERWRITER]: ACTIONS,
  [ROLE.CREDIT_MGR]: ['view', 'act', 'decide', 'query', 'respond', 'reject'],
  [ROLE.VALUATION_USER]: ['view', 'act'],
  [ROLE.SOLICITOR]: ['view', 'act', 'respond'],
  [ROLE.BROKER]: ['view', 'act', 'respond'],
  [ROLE.LEGAL]: ['view'],
  [ROLE.PORTFOLIO]: ['view'],
};

module.exports = {
  async run(db) {
    // 1) new roles at fixed ids
    await db.raw(
      'SET IDENTITY_INSERT dbo.roles ON;\n' +
      "IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id=13) INSERT INTO roles (role_id, role_name) VALUES (13, N'Valuation User');\n" +
      "IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id=14) INSERT INTO roles (role_id, role_name) VALUES (14, N'Broker');\n" +
      'SET IDENTITY_INSERT dbo.roles OFF;',
    );

    // 2) modules
    const mods = [
      ['UNDERWRITING', 'Underwriting', null, 22],
      ['UNDERWRITING.CASE', 'Underwriting Case', 'UNDERWRITING', 23],
    ];
    for (const [code, name, parent, sort] of mods) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code=@p0)
           INSERT INTO modules (module_code, module_name, parent_code, sort_order) VALUES (@p0, @p1, @p2, @p3);`,
        [code, name, parent, sort],
      );
    }

    // 3) permission catalogue
    for (const act of ACTIONS) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key='UNDERWRITING.CASE' AND permission_key=@p0)
           INSERT INTO permissions (module_key, permission_key, description) VALUES ('UNDERWRITING.CASE', @p0, @p1);`,
        [act, act + ' underwriting case'],
      );
    }

    // 4) grants by role_id
    for (const roleId of Object.keys(GRANTS)) {
      for (const act of GRANTS[roleId]) {
        await db.query(
          `DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key='UNDERWRITING.CASE' AND permission_key=@p1);
           IF @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@p0 AND permission_id=@p)
             INSERT INTO role_permissions (role_id, permission_id) VALUES (@p0, @p);`,
          [Number(roleId), act],
        );
      }
    }
  },
};
