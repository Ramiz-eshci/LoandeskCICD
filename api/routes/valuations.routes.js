'use strict';

/**
 * Valuations routes. RBAC on the dedicated VALUATION module (view / edit) —
 * separate from UNDERWRITING.CASE (seeded by 20260101000043_rbac_modules_v3).
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/valuations.controller');

const M = 'VALUATION';

router.get('/', authenticate, requirePermission(M, 'view'), ctrl.list);
router.post('/:id/decision', authenticate, requirePermission(M, 'edit'), ctrl.decide);

module.exports = router;
