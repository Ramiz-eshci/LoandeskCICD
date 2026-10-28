"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission, requireAnyPermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/reports.controller");

// Client 26-10-2026: one Roles row per report. The section opens with view on ANY
// report; each report then checks its own REPORTS.<X> view in reports.service.
const anyReport = requireAnyPermission(
  ["SUMMARY", "ENQUIRY", "APPLICATION", "UNDERWRITING", "PORTFOLIO", "FINANCE"].map((r) => [`REPORTS.${r}`, "view"]),
);

// All reports routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, anyReport, ctrl.list);
// Live cross-module showcase report (Enquiry + Underwriting + Portfolio).
router.get("/showcase", authenticate, anyReport, ctrl.showcase);
router.get("/showcase/detail", authenticate, anyReport, ctrl.detail);
router.get("/showcase/export", authenticate, anyReport, ctrl.exportReport);
router.get("/module/:section/export", authenticate, anyReport, ctrl.exportModule);
router.get("/module/:section", authenticate, anyReport, ctrl.moduleReport);
router.get("/:id", authenticate, anyReport, ctrl.getById);
router.post("/", authenticate, requirePermission("REPORTS", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("REPORTS", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("REPORTS", "delete"), ctrl.remove);

module.exports = router;
