'use strict';

/**
 * Notification routes — the current user's bell feed. Auth only (personal data,
 * scoped to the JWT user); no RBAC module gate.
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const ctrl = require('../controllers/notification.controller');

router.get('/', authenticate, ctrl.list);
router.get('/unread-count', authenticate, ctrl.unreadCount);
router.patch('/:id/read', authenticate, ctrl.markRead);
router.post('/read-all', authenticate, ctrl.markAllRead);

module.exports = router;
