'use strict';

/**
 * Portfolio Extensions (client 30-09-2026) - mounted at /api/extensions.
 *
 *   PORTFOLIO.EXTENSION          view  list / open / preview PDFs / download files
 *                                add   raise from a facility (POST /facilities/:id)
 *                                edit  save form, send agreement, upload / delete files, submit, cancel,
 *                                      mark upfront fees paid (payment schedule)
 *   PORTFOLIO.HEAD_OF_EXTENSION  view  open + preview everything, approve / reject
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission, requireAnyPermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/extension.controller');
const { requireFacilityInScope } = require('../middlewares/portfolio-scope');

const EXT = 'PORTFOLIO.EXTENSION';
const HEAD = 'PORTFOLIO.HEAD_OF_EXTENSION';
const VIEW = requireAnyPermission([[EXT, 'view'], [EXT, 'edit'], [HEAD, 'view']]);
const EDIT = requirePermission(EXT, 'edit');

router.get('/', authenticate, VIEW, ctrl.list);
router.get('/counts', authenticate, VIEW, ctrl.counts);
router.get('/head-users', authenticate, EDIT, ctrl.headUsers);
router.post('/facilities/:id', authenticate, requirePermission(EXT, 'add'), requireFacilityInScope, ctrl.create);
router.get('/:id', authenticate, VIEW, ctrl.detail);
router.put('/:id', authenticate, EDIT, ctrl.update);
router.get('/:id/agreement.pdf', authenticate, VIEW, ctrl.agreementPdf);
router.get('/:id/request.pdf', authenticate, VIEW, ctrl.requestPdf);
router.post('/:id/send-agreement', authenticate, EDIT, ctrl.sendAgreement);
router.post('/:id/documents', authenticate, EDIT, ctrl.uploadDocument);
router.get('/:id/documents/:docId/download', authenticate, VIEW, ctrl.downloadDocument);
router.delete('/:id/documents/:docId', authenticate, EDIT, ctrl.deleteDocument);
router.post('/:id/submit', authenticate, EDIT, ctrl.submit);
router.post('/:id/decision', authenticate, requirePermission(HEAD, 'view'), ctrl.decide);
router.post('/:id/cancel', authenticate, EDIT, ctrl.cancel);
router.post('/:id/fees/:feeId/paid', authenticate, EDIT, ctrl.markFeePaid);

module.exports = router;
