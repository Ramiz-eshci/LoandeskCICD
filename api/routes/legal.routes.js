'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/legal.controller');

const M = 'LEGAL';

router.get('/', authenticate, requirePermission(M, 'view'), ctrl.list);
router.get('/:id', authenticate, requirePermission(M, 'view'), ctrl.getCase);
router.put('/:id', authenticate, requirePermission(M, 'edit'), ctrl.update);
router.post('/:id/stage', authenticate, requirePermission(M, 'edit'), ctrl.setStage);
router.post('/:id/conditions', authenticate, requirePermission(M, 'edit'), ctrl.addCondition);
router.post('/:id/conditions/:condId/toggle', authenticate, requirePermission(M, 'edit'), ctrl.toggleCondition);
router.delete('/:id/conditions/:condId', authenticate, requirePermission(M, 'edit'), ctrl.deleteCondition);
// Credit Paper (Credit Deal Summary) - read/write underwriting step 8 from the Legal tab
router.get('/:id/credit-paper', authenticate, requirePermission(M, 'view'), ctrl.getCreditPaper);
router.post('/:id/credit-paper/documents', authenticate, requirePermission(M, 'edit'), ctrl.uploadCreditPaper);
router.get('/:id/credit-paper/documents/:docId/download', authenticate, requirePermission(M, 'view'), ctrl.downloadCreditPaper);
router.delete('/:id/credit-paper/documents/:docId', authenticate, requirePermission(M, 'edit'), ctrl.deleteCreditPaper);

router.post('/:id/complete', authenticate, requirePermission(M, 'edit'), ctrl.complete);

module.exports = router;
