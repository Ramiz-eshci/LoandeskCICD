'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/access.controller');

router.get('/', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'view'), ctrl.listPermissions);

module.exports = router;
