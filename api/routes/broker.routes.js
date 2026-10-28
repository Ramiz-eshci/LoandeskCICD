'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/broker.controller');

// Client 26-10-2026: Brokers has its own Roles group (like Customers) -
// BROKERS = Broker List / dashboard, BROKERS.DOCUMENT = broker documents.
const BR = 'BROKERS';
const DOC = 'BROKERS.DOCUMENT';
router.get('/stats', authenticate, requirePermission(BR, 'view'), ctrl.stats);
router.get('/:id', authenticate, requirePermission(BR, 'view'), ctrl.detail);
router.post('/:id/documents', authenticate, requirePermission(DOC, 'add'), ctrl.uploadDocument);
router.get('/:id/documents/:docId/download', authenticate, requirePermission(DOC, 'view'), ctrl.downloadDocument);
router.delete('/:id/documents/:docId', authenticate, requirePermission(DOC, 'delete'), ctrl.deleteDocument);

module.exports = router;
