'use strict';

/**
 * Role-Based Access Control (A01 Broken Access Control).
 *
 * Server-side authorization only. Admin bypass is keyed on SERVER-SET boolean
 * flags (is_super_admin / is_company_admin), NEVER on a client-supplied role
 * name — a name-based check is a privilege-escalation bug and is forbidden.
 *
 * Permission model (see db/schema.sql):
 *   roles(role_id) 1---* role_permissions *---1 permissions(module_key, permission_key)
 *
 * Usage:
 *   router.post('/x', authenticate, requirePermission('CATEGORY','create'), handler)
 *   router.get('/y',  authenticate, requireRole(1), handler)
 */

const db = require('../config/database');
const R = require('../services/response.service');

function requireRole(...roleIds) {
  const allowed = roleIds.map(Number);
  return function (req, res, next) {
    if (!req.userData) return R.unauthorized(res);
    if (req.userData.isSuperAdmin) return next();
    if (allowed.includes(Number(req.userData.roleId))) return next();
    return R.forbidden(res, 'You do not have the required role');
  };
}

function requirePermission(moduleKey, permissionKey) {
  return async function (req, res, next) {
    try {
      const u = req.userData;
      if (!u) return R.unauthorized(res);

      // admin bypass on server-set booleans only
      if (u.isSuperAdmin || u.isCompanyAdmin) return next();

      const rows = await db.query(
        `SELECT 1
           FROM role_permissions rp
           JOIN permissions p ON p.permission_id = rp.permission_id
           JOIN roles r ON r.role_id = rp.role_id AND r.flag_deleted = 0 AND r.is_active = 1
          WHERE rp.role_id = @p0
            AND p.module_key = @p1
            AND p.permission_key = @p2`,
        [u.roleId, moduleKey, permissionKey]
      );

      if (rows.length) return next();
      return R.forbidden(res, 'You are not authorized for this action');
    } catch (err) {
      return next(err);
    }
  };
}


/**
 * Pass if the active role has ANY of the given (module_key, permission_key)
 * pairs — used where several tab-level permissions can authorise one endpoint
 * (e.g. editing the case is allowed by APPLICANT_DETAILS/LOAN_DETAILS/
 * SECURITY_PROPERTY edit). Admin bypass on server-set booleans only.
 *
 *   requireAnyPermission([['APPLICATIONS.LOAN_DETAILS','edit'], ...])
 */
function requireAnyPermission(pairs) {
  const list = (pairs || []).filter((x) => Array.isArray(x) && x.length === 2);
  return async function (req, res, next) {
    try {
      const u = req.userData;
      if (!u) return R.unauthorized(res);
      if (u.isSuperAdmin || u.isCompanyAdmin) return next();
      if (!list.length) return R.forbidden(res, 'You are not authorized for this action');

      const conds = list.map((_, i) => `(p.module_key = @m${i} AND p.permission_key = @a${i})`).join(' OR ');
      const params = {};
      list.forEach(([m, a], i) => { params[`m${i}`] = m; params[`a${i}`] = a; });
      params.role = u.roleId;
      const rows = await db.queryNamed(
        `SELECT TOP 1 1 AS ok
           FROM role_permissions rp
           JOIN permissions p ON p.permission_id = rp.permission_id
           JOIN roles r ON r.role_id = rp.role_id AND r.flag_deleted = 0 AND r.is_active = 1
          WHERE rp.role_id = @role AND (${conds})`,
        params,
      );
      if (rows.length) return next();
      return R.forbidden(res, 'You are not authorized for this action');
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Boolean check: does this role hold (moduleKey, permissionKey)?
 * Used by controllers that branch on a permission (e.g. enquiry view_all scope)
 * rather than hard-gating the route. Does NOT apply admin bypass — callers
 * check isSuperAdmin/isCompanyAdmin themselves where that is the intent.
 */
async function roleHasPermission(roleId, moduleKey, permissionKey) {
  if (!roleId) return false;
  const rows = await db.query(
    `SELECT 1
       FROM role_permissions rp
       JOIN permissions p ON p.permission_id = rp.permission_id
       JOIN roles r ON r.role_id = rp.role_id AND r.flag_deleted = 0 AND r.is_active = 1
      WHERE rp.role_id = @p0 AND p.module_key = @p1 AND p.permission_key = @p2`,
    [roleId, moduleKey, permissionKey],
  );
  return rows.length > 0;
}

module.exports = { requireRole, requirePermission, requireAnyPermission, roleHasPermission };


