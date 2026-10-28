'use strict';

/**
 * Portfolio + Customers row-level scope ("assigned only" vs "all")
 * — client 29-09-2026, mirrors ENQUIRIES.ALL_ENQUIRIES / ENQUIRY_LIST.
 *
 *   PORTFOLIO.ALL_PORTFOLIO.view   -> see every facility
 *   PORTFOLIO.view (Portfolio List) only -> see only facilities the user worked on
 *   CUSTOMERS.ALL_CUSTOMERS.view   -> see every customer
 *   CUSTOMERS.view (Customer List) only  -> see only customers the user worked on
 *
 * "Worked on" = the user is, on the facility's application, any of:
 *   BDM (applications.assigned_to), underwriter (applications.underwriter_id /
 *   underwriting_cases.underwriter_id / accepted_by), credit manager
 *   (applications.credit_manager_id) or the source enquiry's assignee
 *   (enquiries.assigned_to). Admins always see everything.
 */

const db = require('../config/database');
const R = require('../services/response.service');
const { roleHasPermission } = require('./rbac');

const ALL_PORTFOLIO = 'PORTFOLIO.ALL_PORTFOLIO';
const ALL_CUSTOMERS = 'CUSTOMERS.ALL_CUSTOMERS';

async function scopeFor(req, allModule) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return null;
  const all = await roleHasPermission(u.roleId, allModule, 'view');
  return all ? null : (Number(u.userId) || 0);
}

/** user_id to scope facilities to, or null = all. */
const portfolioScopeUserId = (req) => scopeFor(req, ALL_PORTFOLIO);
/** user_id to scope customers to, or null = all. */
const customerScopeUserId = (req) => scopeFor(req, ALL_CUSTOMERS);

/** SQL predicate: application alias `a` is related to @param. */
function relatedSql(a = 'a', param = 'scope_uid') {
  return `(${a}.assigned_to = @${param} OR ${a}.underwriter_id = @${param} OR ${a}.credit_manager_id = @${param}
       OR EXISTS (SELECT 1 FROM underwriting_cases suc WHERE suc.application_id = ${a}.application_id AND suc.flag_deleted = 0
                    AND (suc.underwriter_id = @${param} OR suc.accepted_by = @${param}))
       OR EXISTS (SELECT 1 FROM enquiries sen WHERE sen.enquiry_id = ${a}.enquiry_id AND sen.assigned_to = @${param}))`;
}

/** Guard for /facilities/:id… — 403 when the facility is outside the caller's scope. */
async function requireFacilityInScope(req, res, next) {
  try {
    const uid = await portfolioScopeUserId(req);
    if (uid === null) return next();
    const rows = await db.queryNamed(
      `SELECT TOP 1 CASE WHEN ${relatedSql('a', 'uid')} THEN 1 ELSE 0 END AS ok
         FROM loans l JOIN applications a ON a.application_id = l.application_id
        WHERE l.flag_deleted = 0 AND (l.loan_number = @key OR TRY_CONVERT(int, @key) = l.loan_id)`,
      { key: String(req.params.id || '').trim(), uid },
    );
    if (!rows.length) return R.notFound(res, 'Facility not found');
    if (rows[0].ok) return next();
    return R.forbidden(res, 'You do not have permission to view this facility.');
  } catch (err) { return next(err); }
}

/** Guard for /customers/:id… — 403 when the customer is outside the caller's scope. */
async function requireCustomerInScope(req, res, next) {
  try {
    const uid = await customerScopeUserId(req);
    if (uid === null) return next();
    const rows = await db.queryNamed(
      `SELECT TOP 1 1 AS ok
         FROM application_applicants aa JOIN applications a ON a.application_id = aa.application_id AND a.flag_deleted = 0
        WHERE aa.applicant_id = @id AND ${relatedSql('a', 'uid')}`,
      { id: Number(req.params.id) || 0, uid },
    );
    if (rows.length) return next();
    return R.forbidden(res, 'You do not have permission to view this customer.');
  } catch (err) { return next(err); }
}

module.exports = {
  ALL_PORTFOLIO, ALL_CUSTOMERS,
  portfolioScopeUserId, customerScopeUserId, relatedSql,
  requireFacilityInScope, requireCustomerInScope,
};
