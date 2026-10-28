'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission, requireAnyPermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/credit.controller');

const M = 'CREDIT';

router.get('/', authenticate, requirePermission(M, 'view'), ctrl.list);
router.get('/:id/paper', authenticate, requirePermission(M, 'view'), ctrl.creditPaper);
// approve / approve-with-conditions / refer need approve; decline needs reject -> either one opens the decision
router.post('/:id/decide', authenticate, requireAnyPermission([[M, 'approve'], [M, 'reject']]), ctrl.decide);

module.exports = router;
