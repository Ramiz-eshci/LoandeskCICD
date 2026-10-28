'use strict';

const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const credit = require('../services/credit.service');
const { roleHasPermission } = require('../middlewares/rbac');

module.exports = {
  async list(req, res) {
    try { return R.ok(res, 'Credit queue', await credit.list(req.query || {})); }
    catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async creditPaper(req, res) {
    try {
      const paper = await credit.creditPaper(Number(req.params.id));
      if (!paper) return R.notFound(res, 'Application not found');
      return R.ok(res, 'Credit paper', paper);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
  async decide(req, res) {
    try {
      // decline -> CREDIT.reject ; approve / approve_conditions / refer -> CREDIT.approve
      const u = req.userData || {};
      if (!u.isSuperAdmin && !u.isCompanyAdmin) {
        const d = String((req.body && req.body.decision) || '').toLowerCase();
        const need = d === 'decline' ? 'reject' : 'approve';
        if (!(await roleHasPermission(u.roleId, 'CREDIT', need))) {
          return R.forbidden(res, `You do not have CREDIT ${need} permission`);
        }
      }
      const out = await credit.decide(Number(req.params.id), req.body || {}, req);
      if (out.notFound) return R.notFound(res, 'Application not found');
      if (!out.ok) return R.badRequest(res, out.error || 'Decision failed');
      return R.ok(res, 'Credit decision recorded', out);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
