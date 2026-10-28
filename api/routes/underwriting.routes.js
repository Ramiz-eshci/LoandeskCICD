'use strict';

/**
 * Underwriting workflow routes (Module-6). RBAC on UNDERWRITING.CASE.<action>.
 * Step-level gating (which role may act on which step) is enforced in the
 * service (canActStep, per-stage UNDERWRITING_STAGES.* permission)
 * on top of these coarse route permissions.
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission, requireAnyPermission } = require('../middlewares/rbac');
// Pen-test 24-10-2026: record-level scope on every /:id route (IDOR)
const { requireUwCaseInScope: uwScope } = require('../middlewares/record-scope');
const ctrl = require('../controllers/underwriting.controller');

const M = 'UNDERWRITING.CASE';

router.get('/meta', authenticate, requirePermission(M, 'view'), ctrl.meta);
router.get('/', authenticate, requirePermission(M, 'view'), ctrl.list);
router.get('/meta/counts', authenticate, requirePermission(M, 'view'), ctrl.counts);
router.get('/:id', authenticate, uwScope, requirePermission(M, 'view'), ctrl.getCase);
router.get('/:id/credit-paper.docx', authenticate, uwScope, requirePermission(M, 'view'), ctrl.downloadCreditPaper);

router.post('/:id/accept', authenticate, uwScope, requirePermission(M, 'approve'), ctrl.accept);
router.post('/:id/reject', authenticate, uwScope, requirePermission(M, 'reject'), ctrl.rejectCase);
router.post('/:id/return-bdm', authenticate, uwScope, requirePermission(M, 'add'), ctrl.returnToBdm);
router.post('/:id/merged-complete', authenticate, uwScope, requirePermission(M, 'add'), ctrl.completeMergedStep);
router.post('/:id/refer-to-credit', authenticate, uwScope, requirePermission(M, 'add'), ctrl.referToCredit);
router.post('/:id/reopen', authenticate, uwScope, requirePermission(M, 'approve'), ctrl.reopenCase);
router.post('/:id/hold', authenticate, uwScope, requirePermission(M, 'add'), ctrl.holdCase);
router.post('/:id/unhold', authenticate, uwScope, requirePermission(M, 'add'), ctrl.resumeCase);

// Quick-add a valuer firm (Valuation Instruction step) — client 07-10-2026.
router.post('/valuer-firms', authenticate, requirePermission(M, 'add'), ctrl.createValuerFirm);
router.put('/valuer-firms/:id', authenticate, requirePermission(M, 'add'), ctrl.updateValuerFirm);
router.post('/solicitors', authenticate, requirePermission(M, 'add'), ctrl.createSolicitor);
// Client 16-10-2026: Borrower's Solicitor dropdown (add / edit) + checks saved per solicitor.
router.post('/borrower-solicitors', authenticate, requirePermission(M, 'add'), ctrl.createBorrowerSolicitor);
router.put('/borrower-solicitors/:solId', authenticate, requirePermission(M, 'add'), ctrl.updateBorrowerSolicitor);
router.get('/borrower-solicitors/:solId/checks', authenticate, requirePermission(M, 'view'), ctrl.borrowerSolicitorChecks);
router.put('/borrower-solicitors/:solId/checks/:checkId', authenticate, requirePermission(M, 'add'), ctrl.saveBorrowerSolicitorCheck);
router.post('/borrower-solicitors/:solId/checks/:checkId/docs', authenticate, requirePermission(M, 'add'), ctrl.addBorrowerSolicitorDoc);
router.get('/borrower-solicitors/:solId/docs/:docId/download', authenticate, requirePermission(M, 'view'), ctrl.downloadBorrowerSolicitorDoc);
router.delete('/borrower-solicitors/:solId/docs/:docId', authenticate, requirePermission(M, 'add'), ctrl.deleteBorrowerSolicitorDoc);
// Client 16-10-2026: Solicitor Quote "Additional costs" names (Masters > Solicitor Cost Types).
router.post('/solicitor-cost-types', authenticate, requirePermission(M, 'add'), ctrl.createSolicitorCostType);
router.put('/solicitor-cost-types/:typeId', authenticate, requirePermission(M, 'add'), ctrl.updateSolicitorCostType);
router.put('/solicitors/:id', authenticate, requirePermission(M, 'add'), ctrl.updateSolicitor);
// Deal-level underwriter notes scratchpad (outside the step process).
router.put('/:id/notes', authenticate, uwScope, requirePermission(M, 'add'), ctrl.saveNotes);
router.put('/:id/loan', authenticate, uwScope, requirePermission(M, 'add'), ctrl.updateLoan);
router.post('/:id/indicative', authenticate, uwScope, requirePermission(M, 'add'), ctrl.saveIndicativeEdit);
// Upload an updated Credit Deal Summary from Step 5 (stored as a DEAL_SUMMARY doc).
router.post('/:id/credit-summary', authenticate, uwScope, requirePermission(M, 'add'), ctrl.uploadCreditSummary);
// Send the final credit paper to the Head of Application users (Final Credit Committee).
router.post('/:id/send-credit-paper', authenticate, uwScope, requirePermission(M, 'add'), ctrl.sendFinalCreditPaper);
// Client 16-10-2026: documents the committee e-mail can attach; signed revised offer upload.
router.get('/:id/documents', authenticate, uwScope, requirePermission(M, 'view'), ctrl.listCaseDocuments);
router.post('/:id/revised-offer/signed', authenticate, uwScope, requirePermission(M, 'add'), ctrl.uploadRevisedSignedOffer);

router.put('/:id/steps/:stepNo', authenticate, uwScope, requirePermission(M, 'add'), ctrl.saveStep);
router.post('/:id/steps/:stepNo/complete', authenticate, uwScope, requirePermission(M, 'add'), ctrl.completeStep);
router.post('/:id/steps/:stepNo/decide', authenticate, uwScope, requirePermission(M, 'approve'), ctrl.decide);
router.post('/:id/send-broker', authenticate, uwScope, requireAnyPermission([['UNDERWRITING.SEND_REQUIREMENTS', 'add'], [M, 'add']]), ctrl.sendRequirementsToBroker);

// ---- Photos / documents (Site Visit & Diligence etc.) ----
router.post('/:id/photos', authenticate, uwScope, requirePermission(M, 'add'), ctrl.uploadPhoto);
router.get('/:id/photos', authenticate, uwScope, requirePermission(M, 'view'), ctrl.listPhotos);
router.get('/:id/photos/:docId/download', authenticate, uwScope, requirePermission(M, 'view'), ctrl.downloadPhoto);
router.get('/:id/signed-offer', authenticate, uwScope, requirePermission(M, 'view'), ctrl.downloadSignedOffer);
router.get('/:id/signed-offer/:docId', authenticate, uwScope, requirePermission(M, 'view'), ctrl.downloadSignedOffer);
router.delete('/:id/photos/:docId', authenticate, uwScope, requirePermission(M, 'add'), ctrl.deletePhoto);

router.post('/:id/queries', authenticate, uwScope, requirePermission(M, 'add'), ctrl.raiseQuery);
router.post('/:id/queries/:queryId/respond', authenticate, uwScope, requirePermission(M, 'add'), ctrl.respondQuery);

module.exports = router;
