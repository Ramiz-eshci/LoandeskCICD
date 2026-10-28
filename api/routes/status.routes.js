"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/status.controller");

// All status routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("STATUS", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("STATUS", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("STATUS", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("STATUS", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("STATUS", "delete"), ctrl.remove);

module.exports = router;
