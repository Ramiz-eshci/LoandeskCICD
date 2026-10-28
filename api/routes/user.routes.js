'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/user.controller');

// All user routes require a valid JWT + the matching RBAC permission.
router.get('/', authenticate, requirePermission('MASTERS.USER_MASTER', 'view'), ctrl.list);
router.get('/:id', authenticate, requirePermission('MASTERS.USER_MASTER', 'view'), ctrl.getById);
router.post('/', authenticate, requirePermission('MASTERS.USER_MASTER', 'add'), ctrl.create);
router.put('/:id', authenticate, requirePermission('MASTERS.USER_MASTER', 'edit'), ctrl.update);
router.delete('/:id', authenticate, requirePermission('MASTERS.USER_MASTER', 'delete'), ctrl.remove);
router.post('/:id/roles', authenticate, requirePermission('MASTERS.USER_MASTER', 'add'), ctrl.assignRoles);
// Client 26-10-2026: admin sets a new password for the user (Edit User screen).
router.post('/:id/password', authenticate, requirePermission('MASTERS.USER_MASTER', 'edit'), ctrl.changePassword);

module.exports = router;
