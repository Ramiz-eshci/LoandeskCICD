'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/masters.controller');

/** Dynamic RBAC: MASTER.<SLUG>.<action> based on the :key param. */
function requireMaster(action) {
  return (req, res, next) => requirePermission(ctrl.moduleKey(req.params.key), action)(req, res, next);
}

router.get('/:key', authenticate, requireMaster('view'), ctrl.list);
router.get('/:key/:id', authenticate, requireMaster('view'), ctrl.getById);
router.post('/:key', authenticate, requireMaster('add'), ctrl.create);
router.put('/:key/:id', authenticate, requireMaster('edit'), ctrl.update);
router.delete('/:key/:id', authenticate, requireMaster('delete'), ctrl.deactivate);
router.delete('/:key/:id/record', authenticate, requireMaster('delete'), ctrl.remove);

module.exports = router;
