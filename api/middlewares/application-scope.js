'use strict';

/**
 * Application row-level scope ("assigned only" vs "all").
 *
 *  - Admins (server-set is_super_admin / is_company_admin) see every application.
 *  - A role holding APPLICATIONS.ALL_APPLICATIONS.view sees every application.
 *  - Everyone else sees only applications assigned to them — i.e. where they are
 *    the BDM (assigned_to), the underwriter (underwriter_id) or the credit
 *    manager (credit_manager_id).
 *
 * Mirrors the enquiry ALL_ENQUIRIES scope (controllers/enquiry.controller.js).
 */

const db = require('../config/database');
const R = require('../services/response.service');
const { roleHasPermission } = require('./rbac');

const ALL_MODULE = 'APPLICATIONS.ALL_APPLICATIONS';

/** user_id to scope to, or null = unrestricted. */
async function viewScopeUserId(req) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return null;
  const all = await roleHasPermission(u.roleId, ALL_MODULE, 'view');
  return all ? null : (Number(u.userId) || 0);
}

/** SQL fragment (alias `a`) limiting rows to the scoped user. */
function scopeWhere(paramName = 'scope_uid') {
  return ` AND (a.assigned_to = @${paramName} OR a.underwriter_id = @${paramName} OR a.credit_manager_id = @${paramName})`;
}

/** Route guard for /:id routes — 403 when the application is outside the caller's scope. */
async function requireApplicationInScope(req, res, next) {
  try {
    const uid = await viewScopeUserId(req);
    if (uid === null) return next();
    const id = Number(req.params.id);
    const rows = await db.query(
      `SELECT assigned_to, underwriter_id, credit_manager_id
         FROM applications WHERE application_id = @p0 AND flag_deleted = 0`,
      [id],
    );
    if (!rows.length) return R.notFound(res, 'Application not found');
    const r = rows[0];
    if ([r.assigned_to, r.underwriter_id, r.credit_manager_id].some((v) => Number(v) === uid)) return next();
    return R.forbidden(res, 'This application is not assigned to you');
  } catch (err) {
    return next(err);
  }
}

module.exports = { ALL_MODULE, viewScopeUserId, scopeWhere, requireApplicationInScope };
