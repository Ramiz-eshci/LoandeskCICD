'use strict';

/**
 * Roles & Permissions management (Doc-03: Roles, Permissions).
 * Backend-controlled RBAC — permissions are stored in the DB and granted to
 * roles here; the frontend never hardcodes them.
 * Additional roles can be created at runtime (Section 3).
 */

const db = require('../config/database');
const T = require('./common/table.controller');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const audit = require('../services/audit.service');
const { check } = require('../utils/validate');
const { NAME } = require('../utils/validators');

module.exports = {
  //#region roles
  async listRoles(req, res) {
    try {
      const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
      const page = Math.max(1, int(req.query.page, 1));
      const per = Math.min(100, Math.max(1, int(req.query.per_page, 20)));
      const search = String(req.query.search || '').trim();

      let where = 'flag_deleted = 0';
      const p = {};
      if (req.query.active === '1') where += ' AND is_active = 1';
      if (search) {
        where += ' AND (role_name LIKE @search OR description LIKE @search)';
        p.search = '%' + search + '%';
      }
      p.off = (page - 1) * per;
      p.lim = per;

      const rows = await db.queryNamed(
        `SELECT role_id, role_name, description, is_active
           FROM ${T.TBL_ROLES}
          WHERE ${where}
          ORDER BY role_id DESC
          OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
        p,
      );
      const cnt = await db.queryNamed(`SELECT COUNT(*) AS total FROM ${T.TBL_ROLES} WHERE ${where}`, p);
      const total = cnt[0] ? cnt[0].total : 0;
      return R.paginated(res, 'Roles', rows, {
        page, per_page: per, total, total_pages: Math.ceil(total / per) || 1,
      });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async createRole(req, res) {
    try {
      const v = check(req.body, { roleName: 'required' });
      if (!v.ok) return R.badRequest(res, 'Validation Error', v.errors);
      if (!NAME.test(String(req.body.roleName).trim())) {
        return R.badRequest(res, 'Validation Error', { roleName: ['Only letters, spaces, . \' and - are allowed (no numbers or special characters)'] });
      }
      const dup = await db.query(
        `SELECT 1 FROM ${T.TBL_ROLES} WHERE role_name = @p0 AND flag_deleted = 0`,
        [String(req.body.roleName)]
      );
      if (dup.length) return R.badRequest(res, 'Role already exists');
      const ins = await db.query(
        `INSERT INTO ${T.TBL_ROLES} (role_name, description)
         OUTPUT INSERTED.role_id VALUES (@p0, @p1)`,
        [String(req.body.roleName), req.body.description ?? null]
      );
      await audit.write(audit.fromReq(req, { action: 'ROLE_CREATE', moduleKey: 'ROLE', entityName: 'roles', entityId: ins[0].role_id, details: { roleName: req.body.roleName } }));
      return R.created(res, 'Role created', { roleId: ins[0].role_id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async updateRole(req, res) {
    try {
      const id = Number(req.params.id);
      const exists = await db.query(
        `SELECT 1 FROM ${T.TBL_ROLES} WHERE role_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!exists.length) return R.notFound(res, 'Role not found');
      if (req.body.roleName != null && req.body.roleName !== '' && !NAME.test(String(req.body.roleName).trim())) {
        return R.badRequest(res, 'Validation Error', { roleName: ['Only letters, spaces, . \' and - are allowed (no numbers or special characters)'] });
      }
      await db.query(
        `UPDATE ${T.TBL_ROLES}
            SET role_name  = COALESCE(@p1, role_name),
                description = COALESCE(@p2, description),
                is_active  = COALESCE(@p3, is_active),
                updated_at = SYSUTCDATETIME()
          WHERE role_id = @p0`,
        [
          id,
          req.body.roleName ?? null,
          req.body.description ?? null,
          req.body.is_active != null ? (req.body.is_active ? 1 : 0) : null,
        ]
      );
      await audit.write(audit.fromReq(req, { action: 'ROLE_UPDATE', moduleKey: 'ROLE', entityName: 'roles', entityId: id }));
      return R.ok(res, 'Role updated', { roleId: id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async deleteRole(req, res) {
    try {
      const id = Number(req.params.id);
      if (id === 1) return R.badRequest(res, 'System Administrator role cannot be deleted');
      await db.query(
        `UPDATE ${T.TBL_ROLES} SET flag_deleted = 1 WHERE role_id = @p0`,
        [id]
      );
      await audit.write(audit.fromReq(req, { action: 'ROLE_DELETE', moduleKey: 'ROLE', entityName: 'roles', entityId: id }));
      return R.ok(res, 'Role deleted', { roleId: id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion

  //#region permissions
  async listPermissions(req, res) {
    try {
      const rows = await db.query(
        `SELECT permission_id, module_key, permission_key, description
           FROM ${T.TBL_PERMISSIONS} ORDER BY module_key, permission_key`
      );
      return R.ok(res, 'Permissions', rows);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /** GET /roles/:id/permissions -> permission ids granted to the role */
  async getRolePermissions(req, res) {
    try {
      const id = Number(req.params.id);
      const rows = await db.query(
        `SELECT p.permission_id, p.module_key, p.permission_key
           FROM ${T.TBL_ROLE_PERMISSIONS} rp
           JOIN ${T.TBL_PERMISSIONS} p ON p.permission_id = rp.permission_id
          WHERE rp.role_id = @p0
          ORDER BY p.module_key, p.permission_key`,
        [id]
      );
      return R.ok(res, 'Role permissions', rows);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /** PUT /roles/:id/permissions  { permissionIds: [..] }  (full replace) */
  async setRolePermissions(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Array.isArray(req.body.permissionIds)) {
        return R.badRequest(res, 'permissionIds array required');
      }
      const roleRow = await db.query(
        `SELECT 1 FROM ${T.TBL_ROLES} WHERE role_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!roleRow.length) return R.notFound(res, 'Role not found');

      await db.query(`DELETE FROM ${T.TBL_ROLE_PERMISSIONS} WHERE role_id = @p0`, [id]);
      for (const pid of req.body.permissionIds) {
        await db.query(
          `IF EXISTS (SELECT 1 FROM ${T.TBL_PERMISSIONS} WHERE permission_id = @p1)
             INSERT INTO ${T.TBL_ROLE_PERMISSIONS} (role_id, permission_id) VALUES (@p0, @p1)`,
          [id, Number(pid)]
        );
      }
      await audit.write(audit.fromReq(req, { action: 'PERMISSION_CHANGE', moduleKey: 'ROLE', entityName: 'roles', entityId: id, details: { permissionIds: req.body.permissionIds } }));
      return R.ok(res, 'Role permissions updated', { roleId: id, count: req.body.permissionIds.length });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
  //#endregion
};
