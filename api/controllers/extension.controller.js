'use strict';

const path = require('path');
const { disposition } = require('../utils/disposition');
const fs = require('fs');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const ext = require('../services/extension.service');
const { roleHasPermission } = require('../middlewares/rbac');
const { portfolioScopeUserId } = require('../middlewares/portfolio-scope');

/** Head of Extension (or admin) sees every extension; others follow the Portfolio row scope. */
async function isHead(req) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return true;
  return roleHasPermission(u.roleId, ext.HEAD_MODULE, 'view');
}
async function scopeUid(req) {
  if (await isHead(req)) return null;
  return portfolioScopeUserId(req);
}
/** 404 unless the extension is inside the caller's scope. */
async function guard(req, res) {
  if (await ext.inScope(req.params.id, await scopeUid(req))) return true;
  R.forbidden(res, 'You do not have permission to view this extension.');
  return false;
}
const sendPdf = (res, built, inline = true) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', disposition(built.fileName, inline ? 'inline' : 'attachment'));
  return res.send(built.buf);
};
const fail = (res, out, notFoundMsg = 'Extension not found') => {
  if (out.notFound) return R.notFound(res, notFoundMsg);
  return R.badRequest(res, 'Validation Error', out.errors);
};

module.exports = {
  async list(req, res) {
    try {
      const { rows, meta } = await ext.list(req.query || {}, { scopeUserId: await scopeUid(req) });
      return R.paginated(res, 'Extensions', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async counts(req, res) {
    try {
      const data = await ext.counts({ scopeUserId: await scopeUid(req) });
      return R.ok(res, 'Extension counts', { ...data, is_head: await isHead(req) });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async detail(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const row = await ext.get(req.params.id);
      if (!row) return R.notFound(res, 'Extension not found');
      return R.ok(res, 'Extension', row);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async create(req, res) {
    try {
      const out = await ext.create(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out, 'Facility not found');
      return R.created(res, `Extension ${out.ref} raised`, { id: out.id, ref: out.ref });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async update(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.update(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out);
      return R.ok(res, 'Extension saved', await ext.get(req.params.id));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async agreementPdf(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const built = await ext.agreementPdf(req.params.id);
      if (!built) return R.notFound(res, 'Extension not found');
      return sendPdf(res, built, req.query.download !== '1');
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async requestPdf(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const built = await ext.requestPdf(req.params.id);
      if (!built) return R.notFound(res, 'Extension not found');
      return sendPdf(res, built, req.query.download !== '1');
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async sendAgreement(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.sendAgreement(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out);
      return R.ok(res, out.emailed ? 'Extension Agreement e-mailed to the borrower' : 'Extension Agreement generated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async uploadDocument(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.uploadDocument(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteDocument(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.deleteDocument(req.params.id, req.params.docId, req);
      if (!out.ok) return fail(res, out, 'Document not found');
      return R.ok(res, 'Document deleted', { ok: true });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadDocument(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const doc = await ext.documentFile(req.params.id, req.params.docId);
      if (!doc || !doc.file_path) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Head of Extension users for the Send popup's checkboxes (client 27-10-2026). */
  async headUsers(req, res) {
    try {
      const rows = await ext.headOfExtensionUsers();
      return R.ok(res, 'Head of Extension users', rows.map((h) => ({ user_id: h.user_id, full_name: h.full_name, email: h.email })));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async submit(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.submit(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out);
      return R.ok(res, 'Sent to the Head of Extension', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async decide(req, res) {
    try {
      if (!(await isHead(req))) return R.forbidden(res, 'Only the Head of Extension can approve or reject an extension');
      const out = await ext.decide(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out);
      return R.ok(res, `Extension ${out.status.toLowerCase()}`, out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Payment schedule: mark an upfront extension fee Paid (client 28-10-2026). */
  async markFeePaid(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.markFeePaid(req.params.id, req.params.feeId, req.body || {}, req);
      if (!out.ok) return fail(res, out, 'Fee not found');
      return R.ok(res, out.completed ? 'Fee marked paid - every upfront fee is paid, extension complete' : 'Fee marked paid', await ext.get(req.params.id));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async cancel(req, res) {
    try {
      if (!(await guard(req, res))) return undefined;
      const out = await ext.cancel(req.params.id, req.body || {}, req);
      if (!out.ok) return fail(res, out);
      return R.ok(res, 'Extension cancelled', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
