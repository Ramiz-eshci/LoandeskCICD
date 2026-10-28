'use strict';

/** Migration: create auth tables (roles, permissions, role_permissions, users) */
module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.roles','U') IS NULL
      CREATE TABLE dbo.roles (
        role_id      INT IDENTITY(1,1) PRIMARY KEY,
        role_name    NVARCHAR(100) NOT NULL,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );`);

    await db.raw(`
      IF OBJECT_ID('dbo.permissions','U') IS NULL
      CREATE TABLE dbo.permissions (
        permission_id  INT IDENTITY(1,1) PRIMARY KEY,
        module_key     NVARCHAR(100) NOT NULL,
        permission_key NVARCHAR(50)  NOT NULL,
        description    NVARCHAR(255) NULL,
        CONSTRAINT UQ_permissions UNIQUE (module_key, permission_key)
      );`);

    await db.raw(`
      IF OBJECT_ID('dbo.role_permissions','U') IS NULL
      CREATE TABLE dbo.role_permissions (
        role_id       INT NOT NULL,
        permission_id INT NOT NULL,
        CONSTRAINT PK_role_permissions PRIMARY KEY (role_id, permission_id),
        CONSTRAINT FK_rp_role FOREIGN KEY (role_id) REFERENCES dbo.roles(role_id),
        CONSTRAINT FK_rp_perm FOREIGN KEY (permission_id) REFERENCES dbo.permissions(permission_id)
      );`);

    await db.raw(`
      IF OBJECT_ID('dbo.users','U') IS NULL
      CREATE TABLE dbo.users (
        user_id          INT IDENTITY(1,1) PRIMARY KEY,
        email            NVARCHAR(255) NOT NULL,
        password_hash    NVARCHAR(255) NOT NULL,
        full_name        NVARCHAR(255) NULL,
        role_id          INT NULL,
        company_id       INT NULL,
        is_super_admin   BIT NOT NULL DEFAULT 0,
        is_company_admin BIT NOT NULL DEFAULT 0,
        flag_deleted     BIT NOT NULL DEFAULT 0,
        created_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_users_email UNIQUE (email),
        CONSTRAINT FK_users_role FOREIGN KEY (role_id) REFERENCES dbo.roles(role_id)
      );`);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.role_permissions','U') IS NOT NULL DROP TABLE dbo.role_permissions;");
    await db.raw("IF OBJECT_ID('dbo.users','U') IS NOT NULL DROP TABLE dbo.users;");
    await db.raw("IF OBJECT_ID('dbo.permissions','U') IS NOT NULL DROP TABLE dbo.permissions;");
    await db.raw("IF OBJECT_ID('dbo.roles','U') IS NOT NULL DROP TABLE dbo.roles;");
  },
};
