'use strict';

/** Masters > Email Settings + Email History (client 17-10-2026). */

const fs = require('fs');
const path = require('path');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const svc = require('../services/emailSettings.service');
const hub = require('../services/emailHub.service');

module.exports = {
  async list(req, res) {
    try { return R.ok(res, 'Email settings', await svc.list()); } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async options(req, res) {
    try { return R.ok(res, 'Options', await svc.options()); } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async get(req, res) {
    try {
      const out = await svc.get(String(req.params.key));
      if (!out) return R.notFound(res, 'Email not found');
      return R.ok(res, 'Email setting', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async save(req, res) {
    try {
      const out = await svc.save(String(req.params.key), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Email not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'Email settings saved', out.data);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async preview(req, res) {
    try {
      const out = svc.preview(String(req.params.key), req.body || {});
      if (!out) return R.notFound(res, 'Email not found');
      return R.ok(res, 'Preview', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async addAttachment(req, res) {
    try {
      const out = await svc.addAttachment(String(req.params.key), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Email not found');
      if (!out.ok) return R.badRequest(res, 'Validation Error', out.errors);
      return R.ok(res, 'File added', { id: out.id });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async removeAttachment(req, res) {
    try {
      const out = await svc.removeAttachment(String(req.params.key), Number(req.params.id), req);
      if (out.notFound) return R.notFound(res, 'File not found');
      return R.ok(res, 'File removed', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async downloadAttachment(req, res) {
    try {
      const f = await svc.getAttachment(String(req.params.key), Number(req.params.id));
      if (!f) return R.notFound(res, 'File not found');
      const abs = path.join(hub.baseDir(), f.file_path);
      if (!fs.existsSync(abs)) return R.notFound(res, 'File is missing on the server');
      return res.download(abs, f.file_name);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async history(req, res) {
    try {
      const out = await svc.history(req.query || {});
      return R.ok(res, 'Email history', { rows: out.rows, summary: out.summary }, out.meta);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async historyItem(req, res) {
    try {
      const out = await svc.historyItem(Number(req.params.id));
      if (!out) return R.notFound(res, 'Email not found');
      return R.ok(res, 'Email', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
