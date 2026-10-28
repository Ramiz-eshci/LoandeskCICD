'use strict';

/**
 * Enquiry routes (Module-4). RBAC via ENQUIRIES.ENQUIRY_LIST.<action>:
 *   view | add | edit | assign | convert  (System Administrator bypasses).
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission, requireAnyPermission } = require('../middlewares/rbac');
// Pen-test 24-10-2026: record-level scope on every /:id route (IDOR)
const { requireEnquiryInScope: enqScope } = require('../middlewares/record-scope');
const ctrl = require('../controllers/enquiry.controller');

const M = 'ENQUIRIES.ENQUIRY_LIST';
// Request Info, Offer (incl. indicatives) and Documents Upload are separate
// modules in the Roles screen, so they are enforced separately here too - a role
// with only ENQUIRY_LIST.edit must not be able to fire them.
const M_REQ = 'ENQUIRIES.REQUEST_INFO';
const M_OFFER = 'ENQUIRIES.OFFER';
const M_DOCS = 'ENQUIRIES.DOCUMENTS_UPLOAD';
const M_SUBMIT = 'ENQUIRIES.SUBMIT_TO_APPLICATION';
const write = (mod) => requireAnyPermission([[mod, 'add'], [mod, 'edit']]);
// Reading stays open to anyone who can view the enquiry itself.
const read = (mod) => requireAnyPermission([[mod, 'view'], [M, 'view']]);

// ---- authenticated ----
router.get('/meta/form-options', authenticate, requirePermission(M, 'view'), ctrl.formOptions);
router.post('/brokers', authenticate, requirePermission(M, 'add'), ctrl.createBroker);
router.put('/brokers/:id', authenticate, requirePermission(M, 'edit'), ctrl.updateBroker);
// Borrower's solicitor master quick add / edit from the New Enquiry popup (client 15-10-2026).
router.post('/solicitors', authenticate, requirePermission(M, 'add'), ctrl.createSolicitor);
router.put('/solicitors/:id', authenticate, requirePermission(M, 'edit'), ctrl.updateSolicitor);
router.get('/meta/counts', authenticate, requirePermission(M, 'view'), ctrl.counts);
router.get('/meta/resolve-map-link', authenticate, requirePermission(M, 'view'), ctrl.resolveMapLink);

router.get('/', authenticate, requirePermission(M, 'view'), ctrl.list);
router.post('/', authenticate, requirePermission(M, 'add'), ctrl.create);

router.get('/:id', authenticate, enqScope, requirePermission(M, 'view'), ctrl.getById);
router.put('/:id', authenticate, enqScope, requirePermission(M, 'edit'), ctrl.update);

router.post('/:id/assign', authenticate, enqScope, requirePermission(M, 'add'), ctrl.assign);
router.post('/:id/status', authenticate, enqScope, requireAnyPermission([[M, 'edit'], [M, 'reject']]), ctrl.changeStatus);

// Decline (with reasons) and bring-back-alive share the Decline right (ENQUIRY_LIST.reject).
router.post('/:id/decline', authenticate, enqScope, requireAnyPermission([[M, 'reject']]), ctrl.decline);
router.post('/:id/reopen', authenticate, enqScope, requireAnyPermission([[M, 'reject']]), ctrl.reopen);
// Client 26-10-2026: delete an enquiry made by mistake (ENQUIRY_LIST.delete).
router.delete('/:id', authenticate, enqScope, requirePermission(M, 'delete'), ctrl.remove);

router.post('/:id/request-info', authenticate, enqScope, write(M_REQ), ctrl.requestInfo);
router.get('/:id/audit', authenticate, enqScope, requirePermission(M, 'view'), ctrl.listAudit);
router.get('/:id/notes', authenticate, enqScope, requirePermission(M, 'view'), ctrl.listNotes);
router.post('/:id/notes', authenticate, enqScope, requirePermission(M, 'edit'), ctrl.addNote);

router.post('/:id/documents', authenticate, enqScope, write(M_DOCS), ctrl.uploadDocument);
router.get('/:id/documents/:docId/download', authenticate, enqScope, read(M_DOCS), ctrl.downloadDocument);
router.patch('/:id/documents/:docId', authenticate, enqScope, write(M_DOCS), ctrl.updateDocument);
router.delete('/:id/documents/:docId', authenticate, enqScope, requireAnyPermission([[M_DOCS, 'delete']]), ctrl.deleteDocument);

router.post('/:id/offer', authenticate, enqScope, write(M_OFFER), ctrl.saveOffer);

// ---- Indicatives (versioned) ----
router.post('/:id/indicative/preview', authenticate, enqScope, write(M_OFFER), ctrl.previewIndicative);
router.post('/:id/indicative', authenticate, enqScope, write(M_OFFER), ctrl.saveIndicative);
router.get('/:id/indicative', authenticate, enqScope, read(M_OFFER), ctrl.listIndicatives);
router.post('/:id/indicative/:vid/send', authenticate, enqScope, write(M_OFFER), ctrl.sendIndicative);
router.get('/:id/indicative/:vid/pdf', authenticate, enqScope, read(M_OFFER), ctrl.indicativePdf);

// ---- Offers (versioned + emailed) ----
router.post('/:id/offer-version', authenticate, enqScope, write(M_OFFER), ctrl.saveOfferVersion);
router.get('/:id/offers', authenticate, enqScope, read(M_OFFER), ctrl.listOffers);
router.post('/:id/offer/:vid/send', authenticate, enqScope, write(M_OFFER), ctrl.sendOfferVersion);
router.post('/:id/offer/:vid/resend', authenticate, enqScope, write(M_OFFER), ctrl.resendOffer);
// Mark offer accepted = its own matrix action (Offer > ACCEPT)
router.post('/:id/offer/:vid/accept', authenticate, enqScope, requirePermission(M_OFFER, 'add'), ctrl.acceptOffer);

router.get('/:id/convert-check', authenticate, enqScope, requirePermission(M_SUBMIT, 'add'), ctrl.convertCheck);
router.post('/:id/convert', authenticate, enqScope, requirePermission(M_SUBMIT, 'add'), ctrl.convert);

module.exports = router;
