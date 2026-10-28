"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/audit.controller");

// All audit routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("AUDIT", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("AUDIT", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("AUDIT", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("AUDIT", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("AUDIT", "delete"), ctrl.remove);

module.exports = router;
