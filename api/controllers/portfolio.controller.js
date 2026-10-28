'use strict';

const path = require('path');
const { disposition } = require('../utils/disposition');
const fs = require('fs');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const portfolio = require('../services/portfolio.service');
const redemption = require('../services/redemption.service');

const { roleHasPermission } = require('../middlewares/rbac');
const { portfolioScopeUserId, customerScopeUserId } = require('../middlewares/portfolio-scope');

/** true if admin, or the active role holds ANY of the (module, action) pairs. */
async function hasAny(req, pairs) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return true;
  for (const [m, a] of pairs) { if (await roleHasPermission(u.roleId, m, a)) return true; }
  return false;
}

async function badDebtAction(req, res, fn, message) {
  try {
    const out = await fn(req.params.id, req.body || {}, req);
    if (out.notFound) return R.notFound(res, 'Facility not found');
    if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
    return R.ok(res, message, out);
  } catch (ex) { return Logs.ErrorHandler(ex, res, req); }
}

module.exports = {
  async contactLookups(req, res) {
    try {
      return R.ok(res, 'Portfolio contact lookups', await portfolio.contactLookups());
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async contacts(req, res) {
    try {
      const { rows, meta } = await portfolio.listContactsPaged(req.query || {}, { scopeUserId: await portfolioScopeUserId(req) });
      return R.paginated(res, 'Portfolio contact logs', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async facilities(req, res) {
    try {
      const { rows, meta } = await portfolio.liveFacilitiesPaged(req.query || {}, { scopeUserId: await portfolioScopeUserId(req) });
      return R.paginated(res, 'Portfolio facilities', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async facilityOptions(req, res) {
    try {
      return R.ok(res, 'Portfolio facility options', await portfolio.liveFacilities({ scopeUserId: await portfolioScopeUserId(req) }));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async summary(req, res) {
    try {
      return R.ok(res, 'Portfolio summary', await portfolio.portfolioSummary({ scopeUserId: await portfolioScopeUserId(req) }));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async facilityDetail(req, res) {
    try {
      const row = await portfolio.facilityDetail(req.params.id);
      if (!row) return R.notFound(res, 'Facility not found');
      return R.ok(res, 'Portfolio facility detail', row);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async contactSchedule(req, res) {
    try {
      const row = await portfolio.contactSchedule(req.params.id);
      if (!row) return R.notFound(res, 'Facility not found');
      return R.ok(res, 'Contact schedule', row);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async listNotes(req, res) {
    try {
      const rows = await portfolio.listNotes(req.params.id);
      if (rows === null) return R.notFound(res, 'Facility not found');
      return R.ok(res, 'Portfolio notes', rows);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async addNote(req, res) {
    try {
      const out = await portfolio.addNote(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Note added', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async createFacilityRequest(req, res) {
    try {
      // Extension -> PORTFOLIO.EXTENSION ; Further Advance -> PORTFOLIO.FURTHER_ADVANCE
      const type = String((req.body && req.body.request_type) || '').toLowerCase();
      const mod = type.includes('further') ? 'PORTFOLIO.FURTHER_ADVANCE' : 'PORTFOLIO.EXTENSION';
      if (!(await hasAny(req, [[mod, 'add']]))) {
        return R.forbidden(res, 'You are not authorized to raise this request');
      }
      const out = await portfolio.createFacilityRequest(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Facility request submitted', {
        id: out.id,
        enquiry_id: out.enquiry_id,
        enquiry_ref: out.enquiry_ref,
        enquiry_error: out.enquiry_error,
        extension_id: out.extension_id,
        extension_ref: out.extension_ref,
      });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  // ---- Bad loans (client 30-09-2026) ----
  async markBadDebt(req, res) { return badDebtAction(req, res, portfolio.markBadDebt, 'Facility marked as bad debt'); },
  async updateBadDebtNote(req, res) { return badDebtAction(req, res, portfolio.updateBadDebtNote, 'Bad debt note updated'); },
  async recordRecovery(req, res) { return badDebtAction(req, res, portfolio.recordRecovery, 'Money received recorded'); },
  async writeOff(req, res) { return badDebtAction(req, res, portfolio.writeOff, 'Facility written off'); },
  async restoreBadDebt(req, res) { return badDebtAction(req, res, portfolio.restoreBadDebt, 'Facility restored to active'); },

  async recordPayment(req, res) {
    try {
      const out = await portfolio.recordPayment(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Payment recorded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async recordFee(req, res) {
    try {
      // All fees (incl. exit fee) = Facility Fees > ADD — enforced on the route.
      const out = await portfolio.recordFee(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Fee recorded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async releaseDrawdown(req, res) {
    try {
      const out = await portfolio.releaseDrawdown(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Drawdown released', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async createCovenant(req, res) {
    try {
      const out = await portfolio.createCovenant(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Covenant added', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateCovenant(req, res) {
    try {
      const out = await portfolio.updateCovenant(req.params.id, req.params.covenantId, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Covenant not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Covenant updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async uploadFacilityDocument(req, res) {
    try {
      const out = await portfolio.uploadFacilityDocument(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteFacilityDocument(req, res) {
    try {
      const out = await portfolio.deleteFacilityDocument(req.params.id, req.params.docId, req);
      if (out.notFound) return R.notFound(res, 'Document not found');
      return R.ok(res, 'Document deleted', { ok: true });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async uploadCustomerDocument(req, res) {
    try {
      const out = await portfolio.uploadCustomerDocument(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Customer not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteCustomerDocument(req, res) {
    try {
      const out = await portfolio.deleteCustomerDocument(req.params.id, req.params.docId, req);
      if (out.notFound) return R.notFound(res, 'Document not found');
      return R.ok(res, 'Document deleted', { ok: true });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteCustomerEnquiryDocument(req, res) {
    try {
      const out = await portfolio.deleteCustomerEnquiryDocument(req.params.id, req.params.docId, req);
      if (out.notFound) return R.notFound(res, 'Document not found');
      return R.ok(res, 'Document deleted', { ok: true });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateFee(req, res) {
    try {
      const out = await portfolio.updateFee(req.params.id, req.params.feeId, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Fee not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Fee updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteFee(req, res) {
    try {
      const out = await portfolio.deleteFee(req.params.id, req.params.feeId, req);
      if (out.notFound) return R.notFound(res, 'Fee not found');
      return R.ok(res, 'Fee deleted', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadFacilityDocument(req, res) {
    try {
      const doc = await portfolio.facilityDocumentFile(req.params.id, req.params.docId);
      if (!doc || !doc.file_path) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadCustomerEnquiryDocument(req, res) {
    try {
      const doc = await portfolio.customerEnquiryDocumentFile(req.params.id, req.params.docId);
      if (!doc || !doc.file_path) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadCustomerDocument(req, res) {
    try {
      const doc = await portfolio.customerDocumentFile(req.params.id, req.params.docId);
      if (!doc || !doc.file_path) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async createRedemption(req, res) {
    try {
      const out = await redemption.create(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, out.emailed ? 'Redemption statement e-mailed' : 'Redemption statement generated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  // ---- Redemption statement (client 30-09-2026) ----
  async redemptionPreview(req, res) {
    try {
      const out = await redemption.preview(req.params.id, req.query || {});
      if (out.notFound) return R.notFound(res, 'Facility not found');
      return R.ok(res, 'Redemption figures', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async redemptionStatementPdf(req, res) {
    try {
      const b = await redemption.statementPdf(req.params.id, req.query || {});
      if (!b) return R.notFound(res, 'Facility not found');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', disposition(b.fileName, 'inline'));
      return res.send(b.buf);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async redemptionStoredPdf(req, res) {
    try {
      const b = await redemption.storedPdf(req.params.id, req.params.redemptionId);
      if (!b) return R.notFound(res, 'Statement not found');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', disposition(b.fileName, 'inline'));
      return res.send(b.buf);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async redemptionRecipients(req, res) {
    try {
      const out = await redemption.recipients(req.params.id);
      if (!out) return R.notFound(res, 'Facility not found');
      return R.ok(res, 'Statement recipients', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async redemptionSettings(req, res) {
    try {
      const out = await redemption.saveSettings(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Facility not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Redemption settings saved', out.settings);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async redemptionResend(req, res) {
    try {
      const out = await redemption.resend(req.params.id, req.params.redemptionId, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Statement not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, out.emailed ? 'Statement e-mailed' : 'E-mail failed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async completeRedemption(req, res) {
    try {
      const out = await portfolio.completeRedemption(req.params.id, req.params.redemptionId, req);
      if (out.notFound) return R.notFound(res, 'Redemption not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Facility redeemed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Redeem Facility from a sent statement (client 26-10-2026): closes the facility. */
  async redeemFromStatement(req, res) {
    try {
      const out = await portfolio.redeemFromStatement(req.params.id, req.params.redemptionId, req);
      if (out.notFound) return R.notFound(res, 'Redemption not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Facility redeemed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async customers(req, res) {
    try {
      const { rows, meta } = await portfolio.customersPaged(req.query || {}, { scopeUserId: await customerScopeUserId(req) });
      return R.paginated(res, 'Portfolio customers', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async customerDetail(req, res) {
    try {
      const row = await portfolio.customerDetail(req.params.id);
      if (!row) return R.notFound(res, 'Customer not found');
      return R.ok(res, 'Portfolio customer detail', row);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateCustomer(req, res) {
    try {
      const out = await portfolio.updateCustomer(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Customer not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Customer updated', { changed: out.changed });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async createContact(req, res) {
    try {
      const out = await portfolio.createContact(req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Contact log created', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateContact(req, res) {
    try {
      const out = await portfolio.updateContact(Number(req.params.logId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Contact log not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Contact log updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteContact(req, res) {
    try {
      return R.ok(res, 'Contact log deleted', await portfolio.deleteContact(Number(req.params.logId), req));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async overdue(req, res) {
    try {
      const rows = await portfolio.overdue();
      return R.ok(res, 'Overdue portfolio follow-ups', { count: rows.length, rows });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
