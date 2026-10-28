'use strict';

/**
 * Application routes (Module-5). RBAC (client 29-09-2026 — the per-tab modules
 * Applicant / Loan / Security / Broker / Documents / Tasks / Communications / Audit /
 * Enquiry Details / Application Readiness were removed, see seeder
 * 20260101000061_permission_cleanup):
 *   APPLICATIONS.APPLICATION_LIST      view   open the list + every tab (All Applications view also opens)
 *                                      add    create an application
 *                                      edit   edit applicant / loan / security, notes, tasks,
 *                                             communications, upload + edit documents
 *                                      delete delete documents
 *   APPLICATIONS.ALL_APPLICATIONS      view   scope: every application, not only assigned ones
 *   APPLICATIONS.SUBMIT_TO_UNDERWRITING approve   (Accept / Send to Underwriting)
 * System Administrator bypasses via is_super_admin.
 *
 * Role effect: Sales/BDM + Head Sales create/edit/submit; Underwriter edits the
 * case tabs and uploads docs; Credit Manager / Branch Manager / Admin / Auditor
 * are read-only; Legal = security(view) + documents; Solicitor = documents only;
 * Portfolio / Collection have no application access.
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission, requireAnyPermission } = require('../middlewares/rbac');
const { requireUnlocked } = require('../middlewares/application-lock');
const { requireApplicationInScope: inScope } = require('../middlewares/application-scope');
const ctrl = require('../controllers/application.controller');

const LIST = 'APPLICATIONS.APPLICATION_LIST';
const ALL = 'APPLICATIONS.ALL_APPLICATIONS';
const SUBMIT = 'APPLICATIONS.SUBMIT_TO_UNDERWRITING';

// open the list / an application: Application List view OR All Applications view
const VIEW = requireAnyPermission([[LIST, 'view'], [ALL, 'view']]);
const EDIT = requirePermission(LIST, 'edit');
const DELETE = requirePermission(LIST, 'delete');
// "can work the case" (status moves, notes)
const CASE_EDIT = [[LIST, 'edit']];

// ---- reads (view) ----
router.get('/meta/form-options', authenticate, VIEW, ctrl.formOptions);
router.get('/meta/counts', authenticate, VIEW, ctrl.counts);
router.get('/', authenticate, VIEW, ctrl.list);
router.post('/', authenticate, requirePermission(LIST, 'add'), ctrl.create);
router.get('/:id', authenticate, inScope, VIEW, ctrl.getById);

// ---- case edit (Sales/BDM, Head Sales, Underwriter) ----
router.put('/:id', authenticate, inScope, EDIT, requireUnlocked, ctrl.update);
router.put('/:id/applicant/:applicantId', authenticate, inScope, EDIT, requireUnlocked, ctrl.updateApplicant);
router.get('/:id/offer-document/:docId', authenticate, inScope, VIEW, ctrl.downloadOfferDoc);
router.put('/:id/directors/:directorId', authenticate, inScope, EDIT, requireUnlocked, ctrl.updateDirector);
router.put('/:id/security/:securityId', authenticate, inScope, EDIT, requireUnlocked, ctrl.updateSecurity);

// ---- status: submit-to-underwriting needs SUBMIT; other moves need case edit or submit ----
router.post('/:id/status', authenticate, inScope, requireAnyPermission([[SUBMIT, 'approve'], ...CASE_EDIT]), ctrl.changeStatus);

// ---- tasks / communications (tabs removed from the screen; API kept) / notes: case workers only ----
router.post('/:id/tasks', authenticate, inScope, EDIT, requireUnlocked, ctrl.addTask);
router.patch('/:id/tasks/:taskId', authenticate, inScope, EDIT, requireUnlocked, ctrl.updateTask);
router.post('/:id/communications', authenticate, inScope, EDIT, requireUnlocked, ctrl.addCommunication);
router.post('/:id/notes', authenticate, inScope, requireAnyPermission(CASE_EDIT), requireUnlocked, ctrl.addNote);
// Request Info — e-mail the chosen recipient (BDM cc'd when sent to broker); case workers only.
router.post('/:id/request-info', authenticate, inScope, requireAnyPermission(CASE_EDIT), requireUnlocked, ctrl.requestInfo);

// ---- documents ----
router.post('/:id/documents', authenticate, inScope, EDIT, requireUnlocked, ctrl.uploadDocument);
router.get('/:id/documents/:docId/download', authenticate, inScope, VIEW, ctrl.downloadDocument);
router.patch('/:id/documents/:docId', authenticate, inScope, EDIT, requireUnlocked, ctrl.updateDocument);
router.delete('/:id/documents/:docId', authenticate, inScope, DELETE, requireUnlocked, ctrl.deleteDocument);

module.exports = router;
