'use strict';

/** Seeder: core RBAC roles + super-admin user.
 *  Roles use FIXED ids (IDENTITY_INSERT) so System Administrator = role_id 1
 *  deterministically (Doc-02 note #4). Idempotent: safe to re-run.
 *  Password below is a DEV credential only — change after first login. */
module.exports = {
  async run(db) {
    // 10 required roles at fixed ids + a generic 'User' (id 11) kept for dummy data.
    // NOTE: IDENTITY_INSERT is connection-scoped, so ON..INSERTs..OFF must run in ONE
    // batch (single db.raw) or the pool may split them across connections.
    const roles = [
      [1, 'System Administrator'],
      [2, 'Sales / BDM'],
      [3, 'Underwriter'],
      [4, 'Credit Manager'],
      [5, 'Legal'],
      [6, 'Solicitor'],
      [7, 'Portfolio'],
      [8, 'Branch Manager'],
      [9, 'Collection Officer'],
      [10, 'Auditor / Compliance'],
      [11, 'User'],
    ];
    const roleInserts = roles
      .map(
        ([id, name]) =>
          `IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id=${id}) ` +
          `INSERT INTO roles (role_id, role_name) VALUES (${id}, N'${name.replace(/'/g, "''")}');`
      )
      .join('\n');
    await db.raw(
      'SET IDENTITY_INSERT dbo.roles ON;\n' + roleInserts + '\nSET IDENTITY_INSERT dbo.roles OFF;'
    );

    // example permission + grant (keeps the existing /example secure route working)
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key='EXAMPLE' AND permission_key='view')
                  INSERT INTO permissions (module_key, permission_key, description) VALUES ('EXAMPLE','view','View example secure endpoint');`);
    await db.raw(`
      DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name='User');
      DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key='EXAMPLE' AND permission_key='view');
      IF @r IS NOT NULL AND @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@r AND permission_id=@p)
        INSERT INTO role_permissions (role_id, permission_id) VALUES (@r,@p);`);

    // super admin user (role_id 1 = System Administrator). password: Admin@123
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM users WHERE email='admin@loandesk.local')
        INSERT INTO users (email, password_hash, full_name, role_id, is_super_admin)
        VALUES ('admin@loandesk.local','$2b$10$4xQUy5idESn/PVPPpVzWHOlUpeW2Vs7Pj/iiLezLwbG.flKKEBDda','System Administrator',1,1);`);

    // map admin into user_roles too (primary workspace)
    await db.raw(`
      DECLARE @u INT = (SELECT user_id FROM users WHERE email='admin@loandesk.local');
      IF @u IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id=@u AND role_id=1)
        INSERT INTO user_roles (user_id, role_id, is_primary) VALUES (@u,1,1);`);
  },
};
