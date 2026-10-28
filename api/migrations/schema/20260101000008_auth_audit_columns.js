'use strict';

/**
 * Migration: fill in the standard audit columns on the RBAC tables
 * (Module-1 point 2: CreatedBy/CreatedAt/UpdatedBy/UpdatedAt/IsActive).
 * Additive + guarded (COL_LENGTH) — never destructive.
 */
module.exports = {
  async up(db) {
    // users: add created_by (updated_by/updated_at/is_active already added in 000005)
    await db.raw(`IF COL_LENGTH('dbo.users','created_by') IS NULL ALTER TABLE dbo.users ADD created_by INT NULL;`);

    // roles: add created_by/updated_by (description/is_active/updated_at added in 000005)
    await db.raw(`IF COL_LENGTH('dbo.roles','created_by') IS NULL ALTER TABLE dbo.roles ADD created_by INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.roles','updated_by') IS NULL ALTER TABLE dbo.roles ADD updated_by INT NULL;`);

    // role_permissions: full audit set
    await db.raw(`IF COL_LENGTH('dbo.role_permissions','created_by') IS NULL ALTER TABLE dbo.role_permissions ADD created_by INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.role_permissions','created_at') IS NULL ALTER TABLE dbo.role_permissions ADD created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();`);
    await db.raw(`IF COL_LENGTH('dbo.role_permissions','updated_by') IS NULL ALTER TABLE dbo.role_permissions ADD updated_by INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.role_permissions','updated_at') IS NULL ALTER TABLE dbo.role_permissions ADD updated_at DATETIME2 NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.role_permissions','is_active') IS NULL ALTER TABLE dbo.role_permissions ADD is_active BIT NOT NULL DEFAULT 1;`);

    // user_roles: add created_by/updated_by/updated_at/is_active (created_at exists)
    await db.raw(`IF COL_LENGTH('dbo.user_roles','created_by') IS NULL ALTER TABLE dbo.user_roles ADD created_by INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.user_roles','updated_by') IS NULL ALTER TABLE dbo.user_roles ADD updated_by INT NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.user_roles','updated_at') IS NULL ALTER TABLE dbo.user_roles ADD updated_at DATETIME2 NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.user_roles','is_active') IS NULL ALTER TABLE dbo.user_roles ADD is_active BIT NOT NULL DEFAULT 1;`);
  },

  async down(db) {
    // additive audit columns are left in place on down() to avoid data loss.
  },
};
