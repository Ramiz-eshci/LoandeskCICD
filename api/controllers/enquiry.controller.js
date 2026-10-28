'use strict';

/**
 * Enquiry controller (Module-4) — thin HTTP layer over services/enquiry.service.
 * No business logic here: it parses/authorises the request, calls the service,
 * and maps the result to the uniform response envelope.
 */

const R = require('../services/response.service');
const { disposition } = require('../utils/disposition');
const Logs = require('./common/logs.controller');
const path = require('path');
const fs = require('fs');
const enquiry = require('../services/enquiry.service');
const offer = require('../services/enquiry.offer.service');
const { roleHasPermission } = require('../middlewares/rbac');
const { resolveMapLink } = require('../services/mapLink.service');

const ENQ = 'ENQUIRIES.ENQUIRY_LIST';

/**
 * Returns the user_id to scope enquiries to, or null for unrestricted.
 * Admins and any role holding ENQUIRY_LIST.view_all see everything; everyone
 * else sees only enquiries assigned to them.
 */
async function viewScopeUserId(req) {
  const u = req.userData || {};
  if (u.isSuperAdmin || u.isCompanyAdmin) return null;
  // "see every enquiry" = holding ENQUIRIES.ALL_ENQUIRIES.view; else only own assignees.
  const all = await roleHasPermission(u.roleId, 'ENQUIRIES.ALL_ENQUIRIES', 'view');
  return all ? null : (u.userId || 0);
}

module.exports = {
  async list(req, res) {
    try {
      const scopeUserId = await viewScopeUserId(req);
      const { rows, meta } = await enquiry.list(req.query || {}, { scopeUserId, currentUserId: req.userData && req.userData.userId });
      return R.paginated(res, 'Enquiries', rows, meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async getById(req, res) {
    try {
      const row = await enquiry.getById(Number(req.params.id));
      if (!row) return R.notFound(res, 'Enquiry not found');
      const scopeUserId = await viewScopeUserId(req);
      if (scopeUserId && Number(row.assigned_to) !== Number(scopeUserId)) {
        return R.forbidden(res, 'This enquiry is not assigned to you');
      }
      return R.ok(res, 'Enquiry', row);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async create(req, res) {
    try {
      const out = await enquiry.create(req.body || {}, req, { source: 'manual' });
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Enquiry created', { id: out.id, enquiry_ref: out.ref });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async update(req, res) {
    try {
      const out = await enquiry.update(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Enquiry updated', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async assign(req, res) {
    try {
      const out = await enquiry.assign(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Enquiry assigned', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async changeStatus(req, res) {
    try {
      const code = String((req.body && req.body.status) || '').trim();
      if (!code) return R.badRequest(res, 'A target status is required');
      // Offer Accepted needs ENQUIRIES.OFFER.add (was .accept) (Roles matrix), not just enquiry edit.
      const u = req.userData || {};
      if (code.toUpperCase() === 'OFFER_ACCEPTED' && !u.isSuperAdmin && !u.isCompanyAdmin
          && !(await roleHasPermission(u.roleId, 'ENQUIRIES.OFFER', 'add'))) {
        return R.forbidden(res, 'You do not have permission to accept offers');
      }
      const out = await enquiry.changeStatus(Number(req.params.id), code, req, req.body && req.body.reason);
      if (!out.ok) return R.badRequest(res, out.error || 'Status change failed');
      return R.ok(res, 'Status updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Decline with master reasons + notes (Decline popup). */
  async decline(req, res) {
    try {
      const out = await enquiry.decline(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Validation Error', out.errors);
      return R.ok(res, 'Enquiry declined', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Delete an enquiry made by mistake (logical delete). */
  async remove(req, res) {
    try {
      const out = await enquiry.remove(Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not delete enquiry');
      return R.ok(res, 'Enquiry deleted', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Bring a declined enquiry back alive. */
  async reopen(req, res) {
    try {
      const out = await enquiry.reopen(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not re-open enquiry');
      return R.ok(res, 'Enquiry re-opened', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async listNotes(req, res) {
    try {
      return R.ok(res, 'Notes', await enquiry.listNotes(Number(req.params.id)));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async addNote(req, res) {
    try {
      const out = await enquiry.addNote(Number(req.params.id), req.body && req.body.note, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Note added', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Pre-flight check for the convert action (shows missing fields to the UI). */
  async convertCheck(req, res) {
    try {
      const row = await enquiry.getById(Number(req.params.id));
      if (!row) return R.notFound(res, 'Enquiry not found');
      const missing = enquiry.checkConvert(row);
      return R.ok(res, missing.length ? 'Missing required fields' : 'Ready to convert', {
        ready: missing.length === 0, missing,
      });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async convert(req, res) {
    try {
      const out = await enquiry.convert(Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (out.alreadyConverted) return R.badRequest(res, 'Enquiry already converted', null, { applicationId: out.applicationId });
      if (!out.ok) return R.badRequest(res, 'Enquiry is missing required fields', { missing: out.missing });
      return R.created(res, 'Converted to application', {
        applicationId: out.applicationId, applicationRef: out.applicationRef,
        grossAmount: out.grossAmount, grossSource: out.grossSource,
        summary: out.summary || null,
      });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async uploadDocument(req, res) {
    try {
      const out = await enquiry.addDocument(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadDocument(req, res) {
    try {
      const doc = await enquiry.getDocument(Number(req.params.id), Number(req.params.docId));
      if (!doc) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateDocument(req, res) {
    try {
      const out = await enquiry.updateDocument(Number(req.params.id), Number(req.params.docId), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Document not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Document updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async deleteDocument(req, res) {
    try {
      const out = await enquiry.deleteDocument(Number(req.params.id), Number(req.params.docId), req);
      return R.ok(res, 'Document deleted', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async saveOffer(req, res) {
    try {
      const out = await enquiry.saveOffer(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not save offer', out.missing ? { missing: out.missing } : null);
      return R.ok(res, 'Offer saved', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  // ---- Indicatives ----
  previewIndicative(req, res) {
    try { return R.ok(res, 'Indicative preview', offer.previewIndicative(req.body || {}).data); }
    catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async saveIndicative(req, res) {
    try {
      const out = await offer.saveIndicative(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not save indicative');
      return R.ok(res, 'Indicative saved', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async listIndicatives(req, res) {
    try { return R.ok(res, 'Indicatives', await offer.listIndicatives(Number(req.params.id))); }
    catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  /** Client 16-10-2026: download any indicative version as PDF (built + stored on first use). */
  async indicativePdf(req, res) {
    try {
      const out = await offer.indicativePdf(Number(req.params.id), Number(req.params.vid), req);
      if (out.notFound) return R.notFound(res, 'Indicative not found');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', disposition(out.fileName));
      return res.send(out.buffer);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async sendIndicative(req, res) {
    try {
      const out = await offer.sendIndicative(Number(req.params.id), Number(req.params.vid), req);
      if (out.notFound) return R.notFound(res, 'Indicative not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not send indicative');
      return R.ok(res, out.emailed ? 'Indicative emailed' : 'Indicative saved but email failed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  // ---- Offers (versioned + emailed) ----
  async saveOfferVersion(req, res) {
    try {
      const out = await offer.saveOfferVersion(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not save offer');
      return R.ok(res, 'Offer version saved', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async listOffers(req, res) {
    try { return R.ok(res, 'Offers', await offer.listOffers(Number(req.params.id))); }
    catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async sendOfferVersion(req, res) {
    try {
      const out = await offer.sendOffer(Number(req.params.id), Number(req.params.vid), req);
      if (out.notFound) return R.notFound(res, 'Offer not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not send offer');
      const msg = out.emailed ? 'Offer emailed' : 'Offer saved but email failed';
      return R.ok(res, msg, out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async resendOffer(req, res) {
    try {
      const out = await offer.resendOffer(Number(req.params.id), Number(req.params.vid), req);
      if (out.notFound) return R.notFound(res, 'Offer not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not resend offer');
      return R.ok(res, out.emailed ? 'Offer re-emailed' : 'Email failed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async acceptOffer(req, res) {
    try {
      const out = await offer.acceptOffer(Number(req.params.id), Number(req.params.vid), req);
      if (out.notFound) return R.notFound(res, 'Offer not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not accept offer');
      return R.ok(res, 'Offer accepted', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async requestInfo(req, res) {
    try {
      const out = await enquiry.requestInfo(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Enquiry not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Could not send the request', out.errors || null);
      return R.ok(res, 'Information request sent to ' + out.recipient, out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async listAudit(req, res) {
    try {
      return R.ok(res, 'Enquiry audit trail', await enquiry.listAudit(Number(req.params.id)));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async createBroker(req, res) {
    try {
      const out = await enquiry.createBroker(req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Broker created', { id: out.id, name: out.name });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateBroker(req, res) {
    try {
      const out = await enquiry.updateBroker(Number(req.params.id), req.body || {}, req);
      if (out && out.notFound) return R.notFound(res, 'Broker not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Broker updated', { id: out.id, name: out.name, company: out.company, email: out.email, phone: out.phone, address: out.address, fca_number: out.fca_number });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async createSolicitor(req, res) {
    try {
      const out = await enquiry.createSolicitor(req.body || {}, req);
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      const { ok, ...data } = out;
      return R.created(res, 'Solicitor created', data);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async updateSolicitor(req, res) {
    try {
      const out = await enquiry.updateSolicitor(Number(req.params.id), req.body || {}, req);
      if (out && out.notFound) return R.notFound(res, 'Solicitor not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      const { ok, ...data } = out;
      return R.ok(res, 'Solicitor updated', data);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async formOptions(req, res) {
    try {
      return R.ok(res, 'Enquiry form options', await enquiry.formOptions(req.userData ? req.userData.userId : null));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  /** Google Maps short link -> long URL with the pin (for the map preview). */
  async resolveMapLink(req, res) {
    try {
      const url = await resolveMapLink(String((req.query || {}).url || ''));
      if (!url) return R.badRequest(res, 'Enter a valid Google Maps link');
      return R.ok(res, 'Map link resolved', { url });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async counts(req, res) {
    try {
      const scopeUserId = await viewScopeUserId(req);
      return R.ok(res, 'Enquiry counts', await enquiry.statusCounts({
        scopeUserId, mine: String((req.query || {}).mine || '') === '1', currentUserId: req.userData && req.userData.userId,
      }));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
