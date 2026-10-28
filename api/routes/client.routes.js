"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requirePermission } = require("../middlewares/rbac");
const ctrl = require("../controllers/client.controller");

// All client routes require a valid JWT + the matching RBAC permission.
router.get("/", authenticate, requirePermission("CUSTOMERS", "view"), ctrl.list);
router.get("/:id", authenticate, requirePermission("CUSTOMERS", "view"), ctrl.getById);
router.post("/", authenticate, requirePermission("CUSTOMERS", "add"), ctrl.create);
router.put("/:id", authenticate, requirePermission("CUSTOMERS", "edit"), ctrl.update);
router.delete("/:id", authenticate, requirePermission("CUSTOMERS", "delete"), ctrl.remove);

module.exports = router;
