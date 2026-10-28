'use strict';

/**
 * Application controller (Module-5) — thin HTTP layer over
 * services/application.service. Parses/authorises the request, calls the
 * service, and maps the result to the uniform response envelope.
 */

const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const path = require('path');
const fs = require('fs');
const application = require('../services/application.service');
const { viewScopeUserId } = require('../middlewares/application-scope');
const { roleHasPermission } = require('../middlewares/rbac');
const db = require('../config/database');

/**
 * Status moves that hand the case over need their own permission — case-edit
 * rights (applicant/loan/security edit) are NOT enough:
 *   -> SUBMITTED     : APPLICATIONS.SUBMIT_TO_UNDERWRITING.approve
 *   -> UNDERWRITING  : SUBMIT_TO_UNDERWRITING.approve (BDM sends) OR
 *                      UNDERWRITING.CASE.approve (underwriter accepts)
 * Admins (server-set flags) bypass.
 */
async function canMoveTo(req, appId, target) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return true;
  const t = String(target || '').toUpperCase();
  if (t !== 'SUBMITTED' && t !== 'UNDERWRITING') return true;
  // Only FORWARD hand-overs are gated; returns/reverts (e.g. Credit Review ->
  // Underwriting, Underwriting -> Submitted) keep the normal case-edit rule.
  const cur = await db.query(
    `SELECT st.code FROM applications a
       LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
      WHERE a.application_id = @p0 AND a.flag_deleted = 0`,
    [appId],
  );
  const from = String((cur[0] && cur[0].code) || '').toUpperCase();
  const forward = t === 'SUBMITTED' ? ['', 'DRAFT'].includes(from) : ['', 'DRAFT', 'SUBMITTED'].includes(from);
  if (!forward) return true;
  if (t === 'SUBMITTED') {
    return roleHasPermission(u.roleId, 'APPLICATIONS.SUBMIT_TO_UNDERWRITING', 'approve');
  }
  if (t === 'UNDERWRITING') {
    return (await roleHasPermission(u.roleId, 'APPLICATIONS.SUBMIT_TO_UNDERWRITING', 'approve'))
      || roleHasPermission(u.roleId, 'UNDERWRITING.CASE', 'approve');
  }
  return true;
}

module.exports = {
  async updateApplicant(req, res) {
    try {
      const out = await application.updateApplicant(Number(req.params.id), Number(req.params.applicantId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Applicant not found for this application');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Applicant updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadOfferDoc(req, res) {
    try {
      const doc = await application.getEnquiryDocumentForApp(Number(req.params.id), Number(req.params.docId));
      if (!doc) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateDirector(req, res) {
    try {
      const out = await application.updateEnquiryDirector(Number(req.params.id), Number(req.params.directorId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Director not found for this application');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Director updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateSecurity(req, res) {
    try {
      const out = await application.updateSecurity(Number(req.params.id), Number(req.params.securityId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Security record not found for this application');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Security updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async list(req, res) {
    try {
      const scopeUserId = await viewScopeUserId(req);
      const { rows, meta } = await application.list(req.query || {}, { scopeUserId, currentUserId: req.userData && req.userData.userId });
      return R.paginated(res, 'Applications', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async getById(req, res) {
    try {
      const row = await application.getById(Number(req.params.id));
      if (!row) return R.notFound(res, 'Application not found');
      return R.ok(res, 'Application', row);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async create(req, res) {
    try {
      const out = await application.create(req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Application created', { id: out.id, application_ref: out.application_ref });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async update(req, res) {
    try {
      const out = await application.update(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Application updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async changeStatus(req, res) {
    try {
      const code = String((req.body && req.body.status) || '').trim();
      if (!code) return R.badRequest(res, 'A target status is required');
      if (!(await canMoveTo(req, Number(req.params.id), code))) {
        return R.forbidden(res, 'You do not have permission to send this application to underwriting');
      }
      const out = await application.changeStatus(Number(req.params.id), code, req, req.body && req.body.reason);
      if (!out.ok) return R.badRequest(res, out.error || 'Status change failed');
      return R.ok(res, 'Status updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async addTask(req, res) {
    try {
      const out = await application.addTask(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Task added', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateTask(req, res) {
    try {
      const out = await application.updateTask(Number(req.params.id), Number(req.params.taskId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Task not found');
      return R.ok(res, 'Task updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async addCommunication(req, res) {
    try {
      const out = await application.addCommunication(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Communication logged', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async addNote(req, res) {
    try {
      const out = await application.addNote(Number(req.params.id), req.body && req.body.note, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Note added', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async requestInfo(req, res) {
    try {
      const out = await application.requestInfo(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not send the request', out.errors);
      return R.ok(res, 'Information request sent', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async uploadDocument(req, res) {
    try {
      const out = await application.addDocument(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadDocument(req, res) {
    try {
      const doc = await application.getDocument(Number(req.params.id), Number(req.params.docId));
      if (!doc) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateDocument(req, res) {
    try {
      const out = await application.updateDocument(Number(req.params.id), Number(req.params.docId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Document not found');
      if (out.ok === false) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Document updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteDocument(req, res) {
    try {
      const out = await application.deleteDocument(Number(req.params.id), Number(req.params.docId), req);
      return R.ok(res, 'Document deleted', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async formOptions(req, res) {
    try {
      return R.ok(res, 'Application form options', await application.formOptions());
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async counts(req, res) {
    try {
      const scopeUserId = await viewScopeUserId(req);
      return R.ok(res, 'Application counts', await application.stageCounts({
        scopeUserId, mine: String((req.query || {}).mine || '') === '1', currentUserId: req.userData && req.userData.userId,
      }));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
