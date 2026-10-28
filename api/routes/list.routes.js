"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/list.controller");

// All list routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("LIST", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("LIST", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("LIST", "create"), ctrl.create);
router.put("/:id", authenticate, requirePermission("LIST", "update"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("LIST", "delete"), ctrl.remove);

module.exports = router;
