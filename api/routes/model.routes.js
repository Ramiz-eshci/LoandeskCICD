"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/model.controller");

// All model routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("MODEL", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("MODEL", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("MODEL", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("MODEL", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("MODEL", "delete"), ctrl.remove);

module.exports = router;
