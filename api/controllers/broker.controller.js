'use strict';

/** Brokers performance listing (client 20-10-2026). Add / edit stays on /api/masters/broker. */
const fs = require('fs');
const path = require('path');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const brokers = require('../services/broker.service');
const { roleHasPermission } = require('../middlewares/rbac');

module.exports = {
  async stats(req, res) {
    try {
      const out = await brokers.stats({ search: req.query.search, active: req.query.active });
      return R.ok(res, 'Broker stats', out);
    } catch (ex) {
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  /* Broker dashboard (client 22-10-2026). */
  async detail(req, res) {
    try {
      const out = await brokers.detail(req.params.id);
      if (!out) return R.notFound(res, 'Broker not found');
      // Document list only for roles with Brokers Document view (client 26-10-2026).
      const u = req.userData || {};
      if (!u.isSuperAdmin && !u.isCompanyAdmin && !(await roleHasPermission(u.roleId, 'BROKERS.DOCUMENT', 'view'))) out.documents = [];
      return R.ok(res, 'Broker', out);
    } catch (ex) {
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async uploadDocument(req, res) {
    try {
      const out = await brokers.uploadDocument(req.params.id, req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Broker not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.created(res, 'Document uploaded', { id: out.id });
    } catch (ex) {
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async downloadDocument(req, res) {
    try {
      const doc = await brokers.documentFile(req.params.id, req.params.docId);
      if (!doc || !doc.file_path) return R.notFound(res, 'Document not found');
      const abs = path.join(global.basePath || path.join(__dirname, '..'), doc.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, doc.file_name);
    } catch (ex) {
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async deleteDocument(req, res) {
    try {
      const out = await brokers.deleteDocument(req.params.id, req.params.docId, req);
      if (out.notFound) return R.notFound(res, 'Document not found');
      return R.ok(res, 'Document deleted', { ok: true });
    } catch (ex) {
      return Logs.ErrorHandler(ex, res, req);
    }
  },
};
