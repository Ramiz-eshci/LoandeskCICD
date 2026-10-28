'use strict';

/** Underwriting workflow controller (Module-6) — thin HTTP layer over the service. */

const R = require('../services/response.service');
const { disposition } = require('../utils/disposition');
const Logs = require('./common/logs.controller');
const uw = require('../services/underwriting.service');
const { roleHasPermission } = require('../middlewares/rbac');

/**
 * The user_id to scope underwriting cases to, or null for unrestricted.
 * Admins and any role holding UNDERWRITING.ALL_CASES.view see every case;
 * everyone else sees unaccepted cases plus the ones they underwrite.
 */
async function viewScopeUserId(req) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return null;
  const all = await roleHasPermission(u.roleId, 'UNDERWRITING.ALL_CASES', 'view');
  return all ? null : (u.userId || 0);
}

module.exports = {
  async meta(req, res) {
    try { return R.ok(res, 'Underwriting meta', await uw.meta()); } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async list(req, res) {
    try {
      const scopeUserId = await viewScopeUserId(req);
      const { rows, meta } = await uw.list(req.query || {}, { scopeUserId, currentUserId: req.userData && req.userData.userId });
      return R.paginated(res, 'Underwriting cases', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async counts(req, res) {
    try {
      const scopeUserId = await viewScopeUserId(req);
      return R.ok(res, 'Stage counts', await uw.stageCounts({ scopeUserId }));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async getCase(req, res) {
    try {
      const c = await uw.getCase(Number(req.params.id));
      if (!c) return R.notFound(res, 'Underwriting case not found');
      // Same rule as the list: a scoped user may open an unaccepted case or
      // their own, but not one another underwriter has taken.
      const scopeUserId = await viewScopeUserId(req);
      if (scopeUserId && c.underwriter_id != null && Number(c.underwriter_id) !== Number(scopeUserId)) {
        return R.forbidden(res, 'This underwriting case is assigned to another underwriter');
      }
      await uw.withStepAccess(c, req);
      return R.ok(res, 'Underwriting case', c);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async rejectCase(req, res) {
    try {
      const out = await uw.rejectCase(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Reject failed', out.errors || null);
      return R.ok(res, 'Case rejected', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async returnToBdm(req, res) {
    try {
      const out = await uw.returnToBdm(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Return failed', out.errors || null);
      return R.ok(res, 'Returned to BDM', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async completeMergedStep(req, res) {
    try {
      const out = await uw.completeMergedStep(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (out.forbidden) return R.forbidden(res, 'You cannot work this step');
      if (!out.ok) return R.badRequest(res, out.error || 'Cannot complete', out.errors || null);
      return R.ok(res, 'Step completed', { next: out.next });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async referToCredit(req, res) {
    try {
      const out = await uw.referToCredit(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (out.forbidden) return R.forbidden(res, 'You cannot work this step');
      if (!out.ok) return R.badRequest(res, out.error || 'Action failed', out.errors || null);
      return R.ok(res, 'Referred to Credit', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async reopenCase(req, res) {
    try {
      const out = await uw.reopenCase(Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Reopen failed', out.errors || null);
      return R.ok(res, 'Case reopened', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async accept(req, res) {
    try {
      const out = await uw.accept(Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Accept failed', out.errors || null);
      return R.ok(res, 'Case accepted', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async uploadPhoto(req, res) {
    try {
      const out = await uw.addPhoto(Number(req.params.id), req.body && req.body.step_no, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Upload failed', out.errors || null);
      return R.created(res, 'Photo uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async listPhotos(req, res) {
    try {
      const step = req.query && req.query.step != null ? Number(req.query.step) : null;
      return R.ok(res, 'Photos', await uw.listPhotos(Number(req.params.id), step));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  /** Signed offer + application form uploaded at convert, shown inline in the review. */
  async downloadSignedOffer(req, res) {
    try {
      const fs = require('fs');
      const path = require('path');
      const doc = await uw.getSignedOffer(Number(req.params.id), req.params.docId ? Number(req.params.docId) : null);
      if (!doc) return R.notFound(res, 'No signed offer uploaded');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      res.type(path.extname(doc.file_name) || 'application/octet-stream');
      res.setHeader('Content-Disposition', disposition(doc.file_name, 'inline'));
      return res.sendFile(path.resolve(abs));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async downloadPhoto(req, res) {
    try {
      const doc = await uw.getPhoto(Number(req.params.id), Number(req.params.docId));
      if (!doc) return R.notFound(res, 'Photo not found');
      res.setHeader('Content-Type', doc.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', disposition(doc.file_name, 'inline'));
      return res.send(doc.buffer);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async deletePhoto(req, res) {
    try {
      await uw.deletePhoto(Number(req.params.id), Number(req.params.docId), req);
      return R.ok(res, 'Photo deleted', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async saveStep(req, res) {
    try {
      const out = await uw.saveStep(Number(req.params.id), Number(req.params.stepNo), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Step not found');
      if (out.forbidden) return R.forbidden(res, 'Your role cannot act on this step');
      if (!out.ok) return R.badRequest(res, out.error || 'Save failed', out.errors || null);
      return R.ok(res, 'Step saved', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async completeStep(req, res) {
    try {
      const out = await uw.completeStep(Number(req.params.id), Number(req.params.stepNo), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Step not found');
      if (out.forbidden) return R.forbidden(res, 'Your role cannot act on this step');
      if (!out.ok) return R.badRequest(res, out.error || 'Complete failed', out.errors || null);
      return R.ok(res, 'Step completed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async decide(req, res) {
    try {
      const out = await uw.decide(Number(req.params.id), Number(req.params.stepNo), req.body || {}, req);
      if (out.forbidden) return R.forbidden(res, 'Your role cannot act on this step');
      if (!out.ok) return R.badRequest(res, out.error || 'Decision failed', out.errors || null);
      return R.ok(res, 'Decision recorded', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async raiseQuery(req, res) {
    try {
      const out = await uw.raiseQuery(Number(req.params.id), req.body || {}, req);
      if (!out.ok) return R.badRequest(res, out.error || 'Query failed', out.errors || null);
      return R.created(res, 'Query raised', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async respondQuery(req, res) {
    try {
      const out = await uw.respondQuery(Number(req.params.id), Number(req.params.queryId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Query not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Response failed', out.errors || null);
      return R.ok(res, 'Query resolved', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async downloadCreditPaper(req, res) {
    try {
      const out = await uw.creditPaperDocx(Number(req.params.id));
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not build the credit paper');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', disposition(out.fileName));
      return res.send(out.buffer);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async sendFinalCreditPaper(req, res) {
    try {
      const b = req.body || {};
      const out = await uw.sendFinalCreditPaper(Number(req.params.id), b.emails || null, req,
        { documents: b.documents, uploads: b.uploads, notes: b.notes });
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Send failed', out.errors || null);
      return R.ok(res, 'Final credit paper sent', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async uploadCreditSummary(req, res) {
    try {
      const out = await uw.uploadCreditSummary(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Upload failed', out.errors || null);
      return R.created(res, 'Credit Deal Summary updated', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async holdCase(req, res) {
    try {
      const out = await uw.setHold(Number(req.params.id), true, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not hold case');
      return R.ok(res, 'Case put on hold', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async resumeCase(req, res) {
    try {
      const out = await uw.setHold(Number(req.params.id), false, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not resume case');
      return R.ok(res, 'Case resumed', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async saveNotes(req, res) {
    try {
      const out = await uw.saveNotes(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Save failed', out.errors || null);
      return R.ok(res, 'Notes saved', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async saveIndicativeEdit(req, res) {
    try {
      const out = await uw.saveIndicativeEdit(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not save the indicative', out.errors || null);
      return R.ok(res, 'Loan terms updated', {
        id: out.id, version: out.version, emailed: out.emailed, email_error: out.email_error, email_to: out.email_to,
        offer_id: out.offer_id, offer_version: out.offer_version, figures: out.figures,
      });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async updateLoan(req, res) {
    try {
      const out = await uw.updateLoan(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Save failed', out.errors || null);
      return R.ok(res, 'Loan figures updated', { amount_requested: out.amount_requested, net_advance: out.net_advance, ltv_pct: out.ltv_pct });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async createValuerFirm(req, res) {
    try {
      const out = await uw.createValuerFirm(req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Could not add valuer firm', out.errors || null);
      return R.created(res, 'Valuer firm added', { id: out.id, name: out.name });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async updateValuerFirm(req, res) {
    try {
      const out = await uw.updateValuerFirm(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Valuer firm not found');
      if (!out.ok) return R.badRequest(res, 'Could not update valuer firm', out.errors || null);
      return R.ok(res, 'Valuer firm updated', { id: out.id, name: out.name, firm: out.firm, email: out.email, phone: out.phone });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async createSolicitor(req, res) {
    try {
      const out = await uw.createSolicitor(req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Could not add solicitor', out.errors || null);
      return R.created(res, 'Solicitor added', { id: out.id, name: out.name, sol_name: out.sol_name, firm: out.firm, email: out.email, phone: out.phone });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async updateSolicitor(req, res) {
    try {
      const out = await uw.updateSolicitor(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Solicitor not found');
      if (!out.ok) return R.badRequest(res, 'Could not update solicitor', out.errors || null);
      return R.ok(res, 'Solicitor updated', { id: out.id, name: out.name, sol_name: out.sol_name, firm: out.firm, email: out.email, phone: out.phone });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async sendRequirementsToBroker(req, res) {
    try {
      const out = await uw.sendRequirementsToBroker(Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Send failed', out.errors || null);
      return R.ok(res, 'Requirements sent to broker', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /* ---- client 16-10-2026 ---- */
  async listCaseDocuments(req, res) {
    try {
      const out = await uw.listCaseDocuments(Number(req.params.id));
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      return R.ok(res, 'Case documents', out.rows);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async uploadRevisedSignedOffer(req, res) {
    try {
      const out = await uw.uploadRevisedSignedOffer(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Underwriting case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Upload failed', out.errors || null);
      return R.created(res, 'Signed offer uploaded', { ids: out.ids, version: out.version });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async createBorrowerSolicitor(req, res) {
    try {
      const out = await uw.saveBorrowerSolicitor(0, req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Could not add solicitor', out.errors || null);
      return R.created(res, 'Solicitor added', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async updateBorrowerSolicitor(req, res) {
    try {
      const out = await uw.saveBorrowerSolicitor(Number(req.params.solId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Solicitor not found');
      if (!out.ok) return R.badRequest(res, 'Could not update solicitor', out.errors || null);
      return R.ok(res, 'Solicitor updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async borrowerSolicitorChecks(req, res) {
    try {
      const out = await uw.borrowerSolicitorChecks(Number(req.params.solId));
      if (out.notFound) return R.notFound(res, 'Solicitor not found');
      return R.ok(res, 'Solicitor checks', { checks: out.checks, docs: out.docs });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async saveBorrowerSolicitorCheck(req, res) {
    try {
      const out = await uw.saveBorrowerSolicitorCheck(Number(req.params.solId), Number(req.params.checkId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Solicitor not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Save failed', out.errors || null);
      return R.ok(res, 'Check saved', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async addBorrowerSolicitorDoc(req, res) {
    try {
      const out = await uw.addBorrowerSolicitorDoc(Number(req.params.solId), Number(req.params.checkId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Solicitor not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Upload failed', out.errors || null);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async downloadBorrowerSolicitorDoc(req, res) {
    try {
      const doc = await uw.getBorrowerSolicitorDoc(Number(req.params.solId), Number(req.params.docId));
      if (!doc) return R.notFound(res, 'Document not found');
      res.setHeader('Content-Type', doc.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', disposition(doc.file_name, 'inline'));
      return res.send(doc.buffer);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async deleteBorrowerSolicitorDoc(req, res) {
    try {
      await uw.deleteBorrowerSolicitorDoc(Number(req.params.solId), Number(req.params.docId), req);
      return R.ok(res, 'Document removed', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async createSolicitorCostType(req, res) {
    try {
      const out = await uw.saveSolicitorCostType(0, req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Could not add cost type', out.errors || null);
      return R.created(res, 'Cost type added', { id: out.id, name: out.name });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async updateSolicitorCostType(req, res) {
    try {
      const out = await uw.saveSolicitorCostType(Number(req.params.typeId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Cost type not found');
      if (!out.ok) return R.badRequest(res, 'Could not update cost type', out.errors || null);
      return R.ok(res, 'Cost type updated', { id: out.id, name: out.name });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
