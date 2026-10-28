'use strict';

/**
 * Record-level access for enquiry and underwriting /:id routes (pen-test 24-10-2026, IDOR).
 *
 * The detail screens already refused records outside the caller's scope, but every other
 * /:id action (notes, documents, offers, steps, photos ...) only checked the module
 * permission - a scoped user could act on another user's record by changing the id.
 * These guards apply the SAME rule as the detail screen to every /:id route:
 *   - enquiry:      scoped users may only touch enquiries assigned to them;
 *   - underwriting: scoped users may touch unaccepted cases (to accept them) or their own.
 * Admins and roles holding the module's ALL_* "view" permission are not restricted.
 */

const db = require('../config/database');
const R = require('../services/response.service');
const { roleHasPermission } = require('./rbac');

async function scopeUserId(req, allModule) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return null;
  const all = await roleHasPermission(u.roleId, allModule, 'view');
  return all ? null : (Number(u.userId) || 0);
}

async function requireEnquiryInScope(req, res, next) {
  try {
    // Deleted (soft delete) enquiries are gone for everyone, admins included.
    const rows = await db.query(
      'SELECT assigned_to FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0',
      [Number(req.params.id) || 0],
    );
    if (!rows.length) return R.notFound(res, 'Enquiry not found');
    const uid = await scopeUserId(req, 'ENQUIRIES.ALL_ENQUIRIES');
    if (uid === null) return next();
    if (Number(rows[0].assigned_to) === uid) return next();
    return R.forbidden(res, 'This enquiry is not assigned to you');
  } catch (err) {
    return next(err);
  }
}

async function requireUwCaseInScope(req, res, next) {
  try {
    const uid = await scopeUserId(req, 'UNDERWRITING.ALL_CASES');
    if (uid === null) return next();
    const rows = await db.query(
      'SELECT underwriter_id FROM underwriting_cases WHERE underwriting_case_id = @p0 AND flag_deleted = 0',
      [Number(req.params.id) || 0],
    );
    if (!rows.length) return R.notFound(res, 'Underwriting case not found');
    const owner = rows[0].underwriter_id;
    if (owner == null || Number(owner) === uid) return next();
    return R.forbidden(res, 'This underwriting case is assigned to another underwriter');
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireEnquiryInScope, requireUwCaseInScope };
