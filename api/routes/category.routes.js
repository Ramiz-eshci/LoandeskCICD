"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/category.controller");

// All category routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("CATEGORY", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("CATEGORY", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("CATEGORY", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("CATEGORY", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("CATEGORY", "delete"), ctrl.remove);

module.exports = router;
