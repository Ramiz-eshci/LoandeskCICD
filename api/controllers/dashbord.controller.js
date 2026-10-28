'use strict';

/**
 * Dashboard controller — thin HTTP layer over services/dashboard.service.
 *
 * The page itself needs no permission: every signed-in user gets a dashboard.
 * Each TILE is gated individually by its own module permission inside the
 * service, so a role only ever receives figures it is allowed to see.
 */

const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const dashboard = require('../services/dashboard.service');

module.exports = {
  async summary(req, res) {
    try {
      return R.ok(res, 'Dashboard', await dashboard.summary(req));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  // kept for backwards compatibility with the old route name
  async list(req, res) {
    try {
      return R.ok(res, 'Dashboard', await dashboard.summary(req));
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
