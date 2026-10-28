'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission, requireAnyPermission } = require('../middlewares/rbac');
const ctrl = require('../controllers/portfolio.controller');
const { requireFacilityInScope, requireCustomerInScope } = require('../middlewares/portfolio-scope');

// Portfolio RBAC (Roles matrix). No umbrella: the top "Portfolio" row (module PORTFOLIO)
// only opens the Portfolio menu / facility list (view). Every facility-detail tab is its
// own module PORTFOLIO.FACILITY_<TAB> (seeder 055). Customers are their own CUSTOMERS module.
const PF = 'PORTFOLIO';
const CUST = 'CUSTOMERS';                     // list + Customer 360 (view only)
const CDOC = 'CUSTOMERS.DOCUMENT';           // Customer 360 documents: view (view + download) / add / delete
const CL = 'PORTFOLIO.CONTACT_LOG';          // Customer Logs (list page) + reminders
const EXT = 'PORTFOLIO.EXTENSION';           // raise extension requests
const FA = 'PORTFOLIO.FURTHER_ADVANCE';      // raise further advance requests
const HEAD_EXT = 'PORTFOLIO.HEAD_OF_EXTENSION'; // approves / rejects extensions (opens the facility)
const BAD = 'PORTFOLIO.FACILITY_BAD_DEBT';   // bad debt tab: view | add (mark / note / money received) | edit (write off / restore)
const FAC = (tab) => 'PORTFOLIO.FACILITY_' + tab;
const FAC_TABS = ['OVERVIEW', 'LOAN_STRUCTURE', 'SCHEDULE', 'TRANSACTIONS', 'INTEREST', 'FEES', 'PAYMENTS',
  'DRAWDOWNS', 'SECURITY', 'VALUATION', 'COVENANTS', 'DOCUMENTS', 'CONTACTS', 'STATEMENTS', 'AMENDMENTS',
  'COLLECTIONS', 'REDEMPTION', 'AUDIT'];

const anyOf = (mods, act) => mods.map((m) => [m, act]);
// "can open the portfolio / a facility" = Portfolio view, a request screen view, or any facility tab view
const OPEN_MODS = [PF, CL, EXT, FA, HEAD_EXT, BAD, ...FAC_TABS.map(FAC)];
const PF_VIEW = requireAnyPermission(anyOf(OPEN_MODS, 'view'));
const REQ_WRITE = requireAnyPermission([[EXT, 'add'], [FA, 'add']]); // exact type checked in the controller

// Row scope (client 29-09-2026): PORTFOLIO.ALL_PORTFOLIO / CUSTOMERS.ALL_CUSTOMERS = see all;
// otherwise only facilities / customers the user worked on (BDM, underwriter, credit, enquiry owner).
router.use('/facilities/:id', authenticate, requireFacilityInScope);
router.use('/customers/:id', authenticate, requireCustomerInScope);

// ---- facilities ----
router.get('/facilities', authenticate, PF_VIEW, ctrl.facilities);
router.get('/facility-options', authenticate, PF_VIEW, ctrl.facilityOptions);
router.get('/summary', authenticate, PF_VIEW, ctrl.summary);
router.get('/facilities/:id', authenticate, PF_VIEW, ctrl.facilityDetail);
// Contacts tab: contact schedule + portfolio notes
router.get('/facilities/:id/contact-schedule', authenticate, requireAnyPermission([[FAC('CONTACTS'), 'view'], [CL, 'view']]), ctrl.contactSchedule);
router.get('/facilities/:id/notes', authenticate, requirePermission(FAC('CONTACTS'), 'view'), ctrl.listNotes);
router.post('/facilities/:id/notes', authenticate, requirePermission(FAC('CONTACTS'), 'add'), ctrl.addNote);
// Amendments: Extension / Further Advance requests
router.post('/facilities/:id/requests', authenticate, REQ_WRITE, ctrl.createFacilityRequest);
// Payments / Fees / Drawdowns / Covenants / Documents tabs
router.post('/facilities/:id/payments', authenticate, requirePermission(FAC('TRANSACTIONS'), 'add'), ctrl.recordPayment);
router.post('/facilities/:id/fees', authenticate, requirePermission(FAC('TRANSACTIONS'), 'add'), ctrl.recordFee);
router.patch('/facilities/:id/fees/:feeId', authenticate, requirePermission(FAC('TRANSACTIONS'), 'edit'), ctrl.updateFee);
router.delete('/facilities/:id/fees/:feeId', authenticate, requirePermission(FAC('TRANSACTIONS'), 'delete'), ctrl.deleteFee);
router.post('/facilities/:id/drawdowns', authenticate, requirePermission(FAC('DRAWDOWNS'), 'add'), ctrl.releaseDrawdown);
router.post('/facilities/:id/covenants', authenticate, requirePermission(FAC('TRANSACTIONS'), 'add'), ctrl.createCovenant);
router.patch('/facilities/:id/covenants/:covenantId', authenticate, requirePermission(FAC('TRANSACTIONS'), 'edit'), ctrl.updateCovenant);
router.post('/facilities/:id/documents', authenticate, requirePermission(FAC('DOCUMENTS'), 'add'), ctrl.uploadFacilityDocument);
router.get('/facilities/:id/documents/:docId/download', authenticate, requirePermission(FAC('DOCUMENTS'), 'view'), ctrl.downloadFacilityDocument);
router.delete('/facilities/:id/documents/:docId', authenticate, requirePermission(FAC('DOCUMENTS'), 'delete'), ctrl.deleteFacilityDocument);

// ---- Bad loans (client 30-09-2026) ----
router.post('/facilities/:id/bad-debt', authenticate, requirePermission(BAD, 'add'), ctrl.markBadDebt);
router.put('/facilities/:id/bad-debt/note', authenticate, requirePermission(BAD, 'add'), ctrl.updateBadDebtNote);
router.post('/facilities/:id/recoveries', authenticate, requirePermission(BAD, 'add'), ctrl.recordRecovery);
router.post('/facilities/:id/write-off', authenticate, requirePermission(BAD, 'edit'), ctrl.writeOff);
router.post('/facilities/:id/restore', authenticate, requirePermission(BAD, 'edit'), ctrl.restoreBadDebt);

// ---- Redemption tab ----
// Client 30-09-2026: daily / full-month interest, minimum months, statement e-mailed (not saved to Documents).
router.get('/facilities/:id/redemption/preview', authenticate, requirePermission(FAC('REDEMPTION'), 'view'), ctrl.redemptionPreview);
router.get('/facilities/:id/redemption/statement.pdf', authenticate, requirePermission(FAC('REDEMPTION'), 'view'), ctrl.redemptionStatementPdf);
router.get('/facilities/:id/redemption/recipients', authenticate, requirePermission(FAC('REDEMPTION'), 'view'), ctrl.redemptionRecipients);
router.put('/facilities/:id/redemption/settings', authenticate, requirePermission(FAC('REDEMPTION'), 'add'), ctrl.redemptionSettings);
router.get('/facilities/:id/redemptions/:redemptionId/statement.pdf', authenticate, requirePermission(FAC('REDEMPTION'), 'view'), ctrl.redemptionStoredPdf);
router.post('/facilities/:id/redemptions/:redemptionId/send', authenticate, requirePermission(FAC('REDEMPTION'), 'add'), ctrl.redemptionResend);
router.post('/facilities/:id/redemptions', authenticate, requirePermission(FAC('REDEMPTION'), 'add'), ctrl.createRedemption);
router.post('/facilities/:id/redemptions/:redemptionId/complete', authenticate, requirePermission(FAC('REDEMPTION'), 'edit'), ctrl.completeRedemption);
router.post('/facilities/:id/redemptions/:redemptionId/redeem', authenticate, requirePermission(FAC('REDEMPTION'), 'edit'), ctrl.redeemFromStatement);

// ---- customers (own CUSTOMERS module: list + Customer 360) ----
router.get('/customers', authenticate, requirePermission(CUST, 'view'), ctrl.customers);
router.get('/customers/:id', authenticate, requirePermission(CUST, 'view'), ctrl.customerDetail);
router.put('/customers/:id', authenticate, requirePermission(CUST, 'edit'), ctrl.updateCustomer);
router.post('/customers/:id/documents', authenticate, requirePermission(CDOC, 'add'), ctrl.uploadCustomerDocument);
router.get('/customers/:id/documents/:docId/download', authenticate, requirePermission(CDOC, 'view'), ctrl.downloadCustomerDocument);
router.get('/customers/:id/enquiry-documents/:docId/download', authenticate, requirePermission(CDOC, 'view'), ctrl.downloadCustomerEnquiryDocument);
router.delete('/customers/:id/documents/:docId', authenticate, requirePermission(CDOC, 'delete'), ctrl.deleteCustomerDocument);
router.delete('/customers/:id/enquiry-documents/:docId', authenticate, requirePermission(CDOC, 'delete'), ctrl.deleteCustomerEnquiryDocument);

// ---- contact log ----
router.get('/lookups', authenticate, PF_VIEW, ctrl.contactLookups);
router.get('/contacts', authenticate, requirePermission(CL, 'view'), ctrl.contacts);
// Logs are written from the facility Contacts tab (PORTFOLIO.FACILITY_CONTACTS); legacy CONTACT_LOG grants still work.
router.post('/contacts', authenticate, requireAnyPermission([[CL, 'add'], [FAC('CONTACTS'), 'add']]), ctrl.createContact);
router.patch('/contacts/:logId', authenticate, requireAnyPermission([[CL, 'edit'], [FAC('CONTACTS'), 'edit']]), ctrl.updateContact);
router.delete('/contacts/:logId', authenticate, requireAnyPermission([[CL, 'delete'], [FAC('CONTACTS'), 'delete']]), ctrl.deleteContact);
router.get('/reminders/overdue', authenticate, requirePermission(CL, 'view'), ctrl.overdue);

module.exports = router;
