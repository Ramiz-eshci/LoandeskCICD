'use strict';

const R = require('../services/response.service');
const { disposition } = require('../utils/disposition');
const Logs = require('./common/logs.controller');
const legal = require('../services/legal.service');

module.exports = {
  async list(req, res) {
    try { return R.ok(res, 'Legal pipeline', await legal.list(req.query || {})); } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async getCase(req, res) {
    try {
      const c = await legal.getCase(Number(req.params.id));
      if (!c) return R.notFound(res, 'Legal case not found');
      return R.ok(res, 'Legal case', c);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async update(req, res) {
    try {
      const out = await legal.updateCase(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Legal case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Update failed');
      return R.ok(res, 'Legal case updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async setStage(req, res) {
    try {
      const out = await legal.setStage(Number(req.params.id), String(req.body && req.body.stage || ''), req);
      if (out.notFound) return R.notFound(res, 'Legal case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Stage change failed');
      return R.ok(res, 'Stage updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async addCondition(req, res) {
    try {
      const out = await legal.addCondition(Number(req.params.id), req.body && req.body.name, req);
      if (!out.ok) return R.badRequest(res, out.error || 'Add failed');
      return R.created(res, 'Condition added', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async toggleCondition(req, res) {
    try {
      const out = await legal.toggleCondition(Number(req.params.id), Number(req.params.condId), req);
      if (out.notFound) return R.notFound(res, 'Condition not found');
      return R.ok(res, 'Condition updated', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async deleteCondition(req, res) {
    try {
      await legal.deleteCondition(Number(req.params.id), Number(req.params.condId), req);
      return R.ok(res, 'Condition removed', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async getCreditPaper(req, res) {
    try {
      const out = await legal.getCreditPaper(Number(req.params.id));
      if (out.notFound) return R.notFound(res, 'Application not found');
      return R.ok(res, 'Credit paper', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async uploadCreditPaper(req, res) {
    try {
      const out = await legal.uploadCreditPaper(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'No underwriting case for this application');
      if (!out.ok) return R.badRequest(res, out.error || 'Upload failed');
      return R.created(res, 'Credit paper uploaded', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async downloadCreditPaper(req, res) {
    try {
      const doc = await legal.getCreditPaperFile(Number(req.params.id), Number(req.params.docId));
      if (!doc) return R.notFound(res, 'Document not found');
      res.setHeader('Content-Type', doc.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', disposition(doc.file_name, 'inline'));
      return res.send(doc.buffer);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async deleteCreditPaper(req, res) {
    try {
      const out = await legal.deleteCreditPaper(Number(req.params.id), Number(req.params.docId), req);
      if (out.notFound) return R.notFound(res, 'No underwriting case for this application');
      return R.ok(res, 'Credit paper document removed', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async complete(req, res) {
    try {
      const out = await legal.complete(Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'Legal case not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Completion failed');
      return R.ok(res, 'Application completed', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
