'use strict';

/** Valuations controller — thin HTTP layer over the valuations service. */

const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const svc = require('../services/valuations.service');

module.exports = {
  async list(req, res) {
    try { return R.ok(res, 'Valuations', await svc.list(req.query || {})); } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async decide(req, res) {
    try {
      const out = await svc.decide(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Valuation not found');
      if (!out.ok) return R.badRequest(res, 'Invalid decision', out.errors || {});
      return R.ok(res, 'Valuation ' + out.result, out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
