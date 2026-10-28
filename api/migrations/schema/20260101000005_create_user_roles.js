'use strict';

/**
 * Migration: multi-role support (Doc-02 note: a user may have MANY roles).
 *  - user_roles junction (user_id, role_id), is_primary marks default workspace.
 *  - additive audit/link columns on existing users & roles (guarded, non-destructive).
 * The existing users.role_id column is kept for backward compatibility;
 * user_roles is the authoritative multi-role mapping used by the
 * "Select Your Workspace" screen.
 */

module.exports = {
  async up(db) {
    // user_roles junction
    await db.raw(`
      IF OBJECT_ID('dbo.user_roles','U') IS NULL
      CREATE TABLE dbo.user_roles (
        user_id     INT NOT NULL,
        role_id     INT NOT NULL,
        is_primary  BIT NOT NULL DEFAULT 0,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_user_roles PRIMARY KEY (user_id, role_id),
        CONSTRAINT FK_ur_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_ur_role FOREIGN KEY (role_id) REFERENCES dbo.roles(role_id)
      );`);
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_user_roles_role')
      CREATE INDEX IX_user_roles_role ON dbo.user_roles(role_id);`);

    // additive columns on users
    await db.raw(`IF COL_LENGTH('dbo.users','branch_id')  IS NULL ALTER TABLE dbo.users ADD branch_id INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.users','phone')      IS NULL ALTER TABLE dbo.users ADD phone NVARCHAR(30) NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.users','is_active')  IS NULL ALTER TABLE dbo.users ADD is_active BIT NOT NULL DEFAULT 1;`);
    await db.raw(`IF COL_LENGTH('dbo.users','updated_by') IS NULL ALTER TABLE dbo.users ADD updated_by INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.users','updated_at') IS NULL ALTER TABLE dbo.users ADD updated_at DATETIME2 NULL;`);
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_users_branch')
      ALTER TABLE dbo.users ADD CONSTRAINT FK_users_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id);`);

    // additive columns on roles
    await db.raw(`IF COL_LENGTH('dbo.roles','description') IS NULL ALTER TABLE dbo.roles ADD description NVARCHAR(255) NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.roles','is_active')   IS NULL ALTER TABLE dbo.roles ADD is_active BIT NOT NULL DEFAULT 1;`);
    await db.raw(`IF COL_LENGTH('dbo.roles','updated_at')  IS NULL ALTER TABLE dbo.roles ADD updated_at DATETIME2 NULL;`);
  },

  async down(db) {
    await db.raw(`
      IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_users_branch')
      ALTER TABLE dbo.users DROP CONSTRAINT FK_users_branch;`);
    await db.raw("IF OBJECT_ID('dbo.user_roles','U') IS NOT NULL DROP TABLE dbo.user_roles;");
    // additive columns left in place on down() to avoid data loss on shared table.
  },
};
