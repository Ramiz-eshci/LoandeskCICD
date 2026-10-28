'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/access.controller');

router.get('/', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'view'), ctrl.listRoles);
router.post('/', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'add'), ctrl.createRole);
router.put('/:id', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'edit'), ctrl.updateRole);
router.delete('/:id', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'delete'), ctrl.deleteRole);
router.get('/:id/permissions', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'view'), ctrl.getRolePermissions);
router.put('/:id/permissions', authenticate, requirePermission('MASTERS.ROLES_MASTER', 'add'), ctrl.setRolePermissions);

module.exports = router;
