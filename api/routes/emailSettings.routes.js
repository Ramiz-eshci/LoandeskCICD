'use strict';

/** /api/email-settings - Masters > Email Settings (client 17-10-2026). */
const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/emailSettings.controller');

const VIEW = requirePermission('MASTERS.EMAIL_SETTINGS', 'view');
const EDIT = requirePermission('MASTERS.EMAIL_SETTINGS', 'edit');

router.get('/', authenticate, VIEW, ctrl.list);
router.get('/options', authenticate, VIEW, ctrl.options);
router.get('/:key', authenticate, VIEW, ctrl.get);
router.put('/:key', authenticate, EDIT, ctrl.save);
router.post('/:key/preview', authenticate, VIEW, ctrl.preview);
router.post('/:key/attachments', authenticate, EDIT, ctrl.addAttachment);
router.delete('/:key/attachments/:id', authenticate, EDIT, ctrl.removeAttachment);
router.get('/:key/attachments/:id/download', authenticate, VIEW, ctrl.downloadAttachment);

module.exports = router;
