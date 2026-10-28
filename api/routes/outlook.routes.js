'use strict';

/**
 * Outlook intake routes.
 *   POST /webhook, /lifecycle  -> PUBLIC (Microsoft Graph calls these).
 *   POST /create-subscription  -> auth + ENQUIRIES.ENQUIRY_LIST.add
 *   GET  /emails               -> auth + ENQUIRIES.ENQUIRY_LIST.view (intake log)
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/outlook.controller');

const M = 'ENQUIRIES.ENQUIRY_LIST';

// ---- public (no auth) — Microsoft Graph ----
router.post('/webhook', ctrl.webhook);
router.post('/lifecycle', ctrl.lifecycle);

// ---- authenticated ----
router.post('/create-subscription', authenticate, requirePermission(M, 'add'), ctrl.createSubscription);
router.get('/emails', authenticate, requirePermission(M, 'view'), ctrl.listEmails);

module.exports = router;
