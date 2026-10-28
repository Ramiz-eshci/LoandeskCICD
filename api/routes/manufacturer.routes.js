"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/manufacturer.controller");

// All manufacturer routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("MANUFACTURER", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("MANUFACTURER", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("MANUFACTURER", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("MANUFACTURER", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("MANUFACTURER", "delete"), ctrl.remove);

module.exports = router;
