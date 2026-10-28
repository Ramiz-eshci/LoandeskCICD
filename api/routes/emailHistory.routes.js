'use strict';

/** /api/email-history - every e-mail the system sent (client 17-10-2026). */
const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/emailSettings.controller');

const VIEW = requirePermission('MASTERS.EMAIL_HISTORY', 'view');

router.get('/', authenticate, VIEW, ctrl.history);
router.get('/:id', authenticate, VIEW, ctrl.historyItem);

module.exports = router;
