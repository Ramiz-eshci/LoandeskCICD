'use strict';

/**
 * Email events registry (client 17-10-2026: Masters > Email Settings).
 *
 * Every automatic e-mail the system sends is listed here ONCE. The key is passed to
 * mail.sendMail({ event }) by the code that sends it; the Email Settings master stores,
 * per key, the extra CC people, an optional custom subject / body and extra attachments.
 *
 *   module       which screen the e-mail belongs to (also the e-mail history filter)
 *   name / desc  shown on the Email Settings screen
 *   to           who the system sends it to (information only - "To" is not configurable)
 *   defaultCc    who the system already copies in (kept unless "Keep system CC" is unticked)
 *   vars         extra plain values the code supplies (on top of the ones used in the default
 *                template, config/emailTemplates.js)
 *   ccFromUser   true = the system CC is typed / picked by the user in the send popup, so it is
 *                always kept ("Keep system CC" does not apply)
 *   system       true = security e-mail (OTP / password reset): logged without its body,
 *                not shown on Email Settings and never gets CC / custom text.
 *
 * Placeholders every configurable e-mail gets automatically (see emailHub.service):
 *   BDMName, UnderwriterName, SenderName, Today
 */

const MODULES = {
  ENQUIRY: 'Enquiry',
  APPLICATION: 'Application',
  UNDERWRITING: 'Underwriting',
  EXTENSION: 'Extension',
  REDEMPTION: 'Redemption',
  AUTH: 'Login',
};

/** Placeholders added by the hub for every configurable e-mail. */
const COMMON_VARS = ['BDMName', 'UnderwriterName', 'SenderName', 'Today'];

/** Dynamic ("involved person") CC choices. Resolved per case at send time. */
const DYNAMIC = {
  BDM: 'Assigned BDM (on the case)',
  UNDERWRITER: 'Assigned Underwriter (on the case)',
  SENDER: 'User who sends the e-mail',
};

const EVENTS = {
  ENQUIRY_INDICATIVE: {
    module: 'ENQUIRY', name: 'Indicative Terms', desc: 'Indicative terms PDF sent from the enquiry (Send Indicatives).',
    to: 'Broker (or borrower when no broker e-mail)', defaultCc: 'Assigned BDM',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName', 'IndicativeNotes'],
  },
  ENQUIRY_OFFER: {
    module: 'ENQUIRY', name: 'Loan Offer', desc: 'Offer letter + application form + AML guide sent from the enquiry.',
    to: 'Broker (or borrower when no broker e-mail)', defaultCc: 'Assigned BDM',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName'],
  },
  ENQUIRY_REVISED_OFFER: {
    module: 'ENQUIRY', ccFromUser: true, name: 'Revised Loan Offer', desc: 'Revised offer letter + revised application form after the loan is edited in underwriting.',
    to: 'Broker (or borrower when no broker e-mail)', defaultCc: 'Addresses picked in the popup',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName'],
  },
  ENQUIRY_INFO_REQUEST: {
    module: 'ENQUIRY', name: 'Information Required (Enquiry)', desc: 'Request for further information from the enquiry.',
    to: 'Broker / Applicant picked in the popup', defaultCc: 'Assigned BDM',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName', 'RequestedItems', 'DueDate', 'Notes'],
  },
  APPLICATION_INFO_REQUEST: {
    module: 'APPLICATION', name: 'Information Required (Application)', desc: 'Request for further information from the application.',
    to: 'BDM / Broker / Applicant picked in the popup', defaultCc: 'Assigned BDM',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName', 'RequestedItems', 'DueDate', 'Notes'],
  },
  APPLICATION_DEAL_SUMMARY: {
    module: 'APPLICATION', name: 'Credit Deal Summary', desc: 'Deal summary PDF sent when a deal enters Applications (one e-mail per person).',
    to: 'Every Head of Application user', defaultCc: 'None',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName', 'Notes', 'Link'],
  },
  UW_INFO_REQUEST: {
    module: 'UNDERWRITING', name: 'Information Required (Underwriting)', desc: 'Request for further information from an underwriting case.',
    to: 'BDM / Broker / Applicant picked in the popup', defaultCc: 'Assigned BDM',
    vars: ['Ref', 'Borrower', 'SecurityAddress', 'RecipientName', 'RequestedItems', 'DueDate', 'Notes'],
  },
  UW_REQUIREMENTS_PACK: {
    module: 'UNDERWRITING', name: 'Requirements Pack', desc: 'Application form + sanction letter + underwriting requirements (one e-mail per person).',
    to: 'Broker or applicant(s)', defaultCc: 'None',
    vars: ['Ref', 'Borrower', 'RecipientName'],
  },
  UW_FINAL_CREDIT_PAPER: {
    module: 'UNDERWRITING', name: 'Final Credit Paper', desc: 'Final credit deal summary for the credit committee (one e-mail per person).',
    to: 'Head of Underwriting users picked in the popup', defaultCc: 'None',
    vars: ['Ref', 'Borrower', 'RecipientName', 'Notes', 'Link'],
  },
  EXTENSION_AGREEMENT: {
    module: 'EXTENSION', ccFromUser: true, name: 'Extension Agreement', desc: 'Extension agreement sent to the borrower for signature.',
    to: 'Address typed in the popup (broker / borrower)', defaultCc: 'Address typed in the popup',
    vars: ['Ref', 'Borrower', 'RecipientName', 'NewMaturity', 'Notes'],
  },
  EXTENSION_REQUEST: {
    module: 'EXTENSION', ccFromUser: true, name: 'Extension Request', desc: 'Extension request paper sent for a decision (one e-mail per person).',
    to: 'Head of Extension users (or address typed in the popup)', defaultCc: 'Address typed in the popup',
    vars: ['Ref', 'Borrower', 'RecipientName', 'Notes', 'Link'],
  },
  REDEMPTION_STATEMENT: {
    module: 'REDEMPTION', ccFromUser: true, name: 'Redemption Statement', desc: 'Redemption statement PDF for a facility.',
    to: 'Addresses picked in the popup', defaultCc: 'Addresses picked in the popup',
    vars: ['Ref', 'Borrower', 'RedemptionAmount', 'RedemptionDate', 'Notes'],
  },
  AUTH_OTP: { module: 'AUTH', name: 'Login Code (OTP)', system: true, to: 'User', defaultCc: 'None', vars: [] },
  AUTH_RESET_PASSWORD: { module: 'AUTH', name: 'Reset Password', system: true, to: 'User', defaultCc: 'None', vars: [] },
};

/** All placeholders allowed for an event: default-template ones + event vars + common ones. */
function varsFor(key) {
  const ev = Object.prototype.hasOwnProperty.call(EVENTS, String(key)) ? EVENTS[key] : null;
  if (!ev || ev.system) return [];
  // required lazily: emailTemplates has no dependency on this file
  const { TEMPLATES } = require('./emailTemplates');
  const t = TEMPLATES[key] || { subject: '', body: '' };
  const out = [];
  const add = (n) => { if (!out.includes(n)) out.push(n); };
  `${t.subject}\n${t.body}`.replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (m, n) => { add(n); return m; });
  ev.vars.forEach(add);
  COMMON_VARS.forEach(add);
  return out;
}

/** Placeholders that are ready-made HTML blocks (inserted as-is). */
function htmlVarsFor(key) {
  const { TEMPLATES } = require('./emailTemplates');
  return (TEMPLATES[key] && TEMPLATES[key].html) || [];
}

module.exports = { EVENTS, MODULES, DYNAMIC, COMMON_VARS, varsFor, htmlVarsFor };
