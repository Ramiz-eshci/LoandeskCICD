"use strict";

/**
 * reports controller.
 *
 * Showcase report (Enquiry + Underwriting + Portfolio):
 *   GET /reports/showcase          -> high-level + initial detail (JSON)
 *   GET /reports/showcase/detail   -> filtered rows for one section (JSON)
 *   GET /reports/showcase/export   -> whole report PDF, or one section CSV
 *
 * CRUD methods remain stubs until saved/scheduled reports are specced.
 */

const R = require("../services/response.service");
const { disposition } = require("../utils/disposition");
const Logs = require("./common/logs.controller");
const reports = require("../services/reports.service");

function filtersFrom(req) {
  return {
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
    search: req.query.search,
    bdm: req.query.bdm,
  };
}

module.exports = {
  async showcase(req, res) {
    try {
      return R.ok(res, "Reports showcase", await reports.showcase(req, filtersFrom(req)));
    } catch (ex) {
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async detail(req, res) {
    try {
      const section = String(req.query.section || "").trim();
      const cap = req.query.cap;
      const out = await reports.detail(req, section, filtersFrom(req), cap);
      return R.ok(res, "Report detail", out);
    } catch (ex) {
      if (ex && ex.status === 403) return R.forbidden(res);
      if (ex && ex.status === 400) return R.badRequest(res, ex.message);
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async moduleReport(req, res) {
    try {
      const section = String(req.params.section || "").trim();
      const out = await reports.moduleReport(req, section, filtersFrom(req));
      return R.ok(res, "Module report", out);
    } catch (ex) {
      if (ex && ex.status === 403) return R.forbidden(res);
      if (ex && ex.status === 400) return R.badRequest(res, ex.message);
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async exportModule(req, res) {
    try {
      const section = String(req.params.section || "").trim();
      const format = String(req.query.format || "xlsx").toLowerCase();
      if (format === "csv") {
        const { filename, buffer } = await reports.exportCsv(req, section, filtersFrom(req));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", disposition(filename));
        return res.send(buffer);
      }
      const { filename, buffer } = await reports.exportXlsx(req, section, filtersFrom(req));
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", disposition(filename));
      return res.send(buffer);
    } catch (ex) {
      if (ex && ex.status === 403) return R.forbidden(res);
      if (ex && ex.status === 400) return R.badRequest(res, ex.message);
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  async exportReport(req, res) {
    try {
      const format = String(req.query.format || "pdf").toLowerCase();
      if (format === "csv") {
        const section = String(req.query.section || "").trim();
        const { filename, buffer } = await reports.exportCsv(req, section, filtersFrom(req));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", disposition(filename));
        return res.send(buffer);
      }
      const { filename, buffer } = await reports.exportPdf(req, filtersFrom(req));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", disposition(filename));
      return res.send(buffer);
    } catch (ex) {
      if (ex && ex.status === 403) return R.forbidden(res);
      return Logs.ErrorHandler(ex, res, req);
    }
  },

  list(req, res) { return R.notImplemented(res, "reports.list not implemented"); },
  getById(req, res) { return R.notImplemented(res, "reports.getById not implemented"); },
  create(req, res) { return R.notImplemented(res, "reports.create not implemented"); },
  update(req, res) { return R.notImplemented(res, "reports.update not implemented"); },
  remove(req, res) { return R.notImplemented(res, "reports.remove not implemented"); },
};
