'use strict';

/**
 * Default subject + body for every configurable e-mail (client 17-10-2026).
 *
 * This is the SAME text and design the system sent before Email Settings existed. The code
 * builds every e-mail from these templates (emailHub.render), and Masters > Email Settings
 * opens with them pre-filled, so a custom version starts from exactly what goes out today.
 *
 * {{Name}}  plain value - HTML-escaped, new lines become <br>
 * html      names listed here are ready-made HTML blocks built by the code (tables, lists,
 *           optional paragraphs). They go in as-is and are empty when not applicable.
 *
 * Subject: a " — " / " – " separator next to an empty value is dropped automatically.
 */

const INFO_REQUEST = (what, signOff) => [
  '<p>Hello {{RecipientName}},</p>',
  `<p>We need some further information to progress ${what} <strong>{{Ref}}</strong> for {{Borrower}}.</p>`,
  '<p><strong>Borrower:</strong> {{Borrower}}</p>',
  '{{SecurityBlock}}',
  '<p><strong>Requested Info:</strong></p>',
  '{{RequestedItemsList}}',
  '{{DueDateBlock}}',
  '{{NotesBlock}}',
  `<p>Many thanks,<br>${signOff}</p>`,
].join('\n');
const INFO_HTML = ['SecurityBlock', 'RequestedItemsList', 'DueDateBlock', 'NotesBlock'];

const TD = 'padding:3px 14px 3px 0;color:#5a7394';
const WRAP = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f2244">';

const TEMPLATES = {
  ENQUIRY_INDICATIVE: {
    subject: 'Your ScotLend Indicative Terms — {{Ref}} — {{SecurityAddress}}',
    body: [
      '<p>Dear {{RecipientName}},</p>',
      '<p>Please find below the indicative figures{{ForBorrower}}, subject to valuation and due diligence. The full indicative terms are also attached as a PDF.</p>',
      '{{FiguresTable}}',
      '<p>Kind regards,<br/>ScotLend Group</p>',
    ].join('\n'),
    html: ['FiguresTable'],
  },

  ENQUIRY_OFFER: {
    subject: 'Your ScotLend Loan Offer — {{Ref}}',
    body: [
      '<p>Hi {{RecipientName}},</p>',
      '<p>Please find attached offer and application form for the client to complete, sign and return.</p>',
      '<p>Please ensure the client completes the asset &amp; liability section on the form.</p>',
      '<p>Please also ensure the clients solicitor details are noted on the form.</p>',
      // Client 20-10-2026
      '<p>Please also provide -</p>',
      '<ul><li>Proof of photographic ID</li><li>Proof of address dated within the last 3 months (supporting document attached)</li><li>Up to date CheckMyFile credit report</li></ul>',
      '<p>Any questions, or if I can help in any way, please let me know.</p>',
      '<p>Kind regards,<br/>ScotLend Group</p>',
    ].join('\n'),
    html: [],
  },

  ENQUIRY_REVISED_OFFER: {
    subject: 'Revised Loan Offer — {{Ref}} — {{SecurityAddress}}',
    body: [
      '<p>Hi {{RecipientName}},</p>',
      '<p>There have been a few changes to the terms of the loan{{ForBorrower}}{{SecurityInBrackets}}.</p>',
      '<p>Please find attached the revised offer letter and the revised application form. Please could the client sign the new terms and return the signed copies to us.</p>',
      '<p>Any questions, or if I can help in any way, please let me know.</p>',
      '<p>Kind regards,<br/>ScotLend Group</p>',
    ].join('\n'),
    html: [],
  },

  ENQUIRY_INFO_REQUEST: { subject: 'Information required - {{Ref}}', body: INFO_REQUEST('enquiry', 'LoanDesk'), html: INFO_HTML },
  APPLICATION_INFO_REQUEST: { subject: 'Information required - {{Ref}}', body: INFO_REQUEST('application', 'LoanDesk'), html: INFO_HTML },
  UW_INFO_REQUEST: { subject: 'Information required - {{Ref}}', body: INFO_REQUEST('application', 'Underwriting Team'), html: INFO_HTML },

  APPLICATION_DEAL_SUMMARY: {
    subject: 'Credit Deal Summary – {{Ref}} – {{Borrower}}',
    body: [
      WRAP,
      '<p>Hi {{RecipientFirstName}},</p>',
      '<p>A new deal has entered the <b>Applications</b> stage and is ready for your review before it goes to underwriting.</p>',
      '<table style="border-collapse:collapse;font-size:13px">',
      `<tr><td style="${TD}">Application</td><td><b>{{Ref}}</b> (from enquiry {{EnquiryRef}})</td></tr>`,
      `<tr><td style="${TD}">Borrower</td><td>{{Borrower}}</td></tr>`,
      `<tr><td style="${TD};vertical-align:top">{{SecurityLabel}}</td><td>{{SecurityLines}}</td></tr>`,
      `<tr><td style="${TD}">Gross Loan</td><td>{{GrossLoan}}</td></tr>`,
      `<tr><td style="${TD}">File Owner</td><td>{{FileOwner}}</td></tr>`,
      '</table>',
      '{{NotesBlock}}',
      '<p style="margin-top:14px">The full Credit Deal Summary is attached. <a href="{{Link}}">Open the application in LoanDesk</a>.</p>',
      '</div>',
    ].join('\n'),
    html: ['SecurityLines', 'NotesBlock'],
  },

  UW_REQUIREMENTS_PACK: {
    subject: 'Requirements Pack — {{Ref}}',
    body: [
      '<p>Dear {{RecipientName}},</p>',
      '<p>Please find attached the application form and the sanction letter for <b>{{Ref}}</b>, together with our underwriting requirements.</p>',
      '{{RequirementsDetails}}',
      '<p>Kind regards,<br/>Underwriting Team</p>',
    ].join('\n'),
    html: ['RequirementsDetails'],
  },

  UW_FINAL_CREDIT_PAPER: {
    subject: 'Final Credit Paper – {{Ref}} – {{Borrower}}',
    body: [
      WRAP,
      '<p>Hi {{RecipientFirstName}},</p>',
      '<p>The <b>final Credit Deal Summary</b> for application <b>{{Ref}}</b> ({{Borrower}}) is ready for the Final Credit Committee review. The complete paper is attached.</p>',
      '{{NotesBlock}}{{AlsoAttachedList}}',
      '<p><a href="{{Link}}">Open the case in LoanDesk</a>.</p>',
      '</div>',
    ].join('\n'),
    html: ['NotesBlock', 'AlsoAttachedList'],
  },

  EXTENSION_AGREEMENT: {
    subject: 'Bridging Loan Extension Agreement – {{LoanNumber}}',
    body: [
      WRAP,
      '<p>Dear {{RecipientName}},</p>',
      '<p>Further to our conversation, please find attached the <b>Bridging Loan Extension Agreement</b> extending your facility {{LoanNumber}} to <b>{{NewMaturity}}</b>.</p>',
      '{{NotesBlock}}',
      '<p>Please sign and date the agreement and return a copy to us.</p>',
      '<p>Kind regards,<br>ScotLend Group</p>',
      '</div>',
    ].join('\n'),
    html: ['NotesBlock'],
  },

  EXTENSION_REQUEST: {
    subject: 'Extension Request – {{Ref}} – {{Borrower}}',
    body: [
      WRAP,
      '<p>Hi {{RecipientFirstName}},</p>',
      '<p>An extension request is ready for your decision.</p>',
      '<table style="border-collapse:collapse;font-size:13px">',
      `<tr><td style="${TD}">Extension</td><td><b>{{Ref}}</b> (facility {{LoanNumber}})</td></tr>`,
      `<tr><td style="${TD}">Borrower</td><td>{{Borrower}}</td></tr>`,
      `<tr><td style="${TD}">Extension</td><td>{{ExtensionMonths}} month(s) to {{NewMaturity}}</td></tr>`,
      `<tr><td style="${TD}">Gross Loan</td><td>{{GrossLoan}}</td></tr>`,
      '</table>',
      '{{NotesBlock}}',
      '<p style="margin-top:14px">The Extension Request paper is attached. <a href="{{Link}}">Open it in LoanDesk to approve or reject</a>.</p>',
      '</div>',
    ].join('\n'),
    html: ['NotesBlock'],
  },

  REDEMPTION_STATEMENT: {
    subject: 'Redemption Statement – {{Ref}} – {{Borrower}}',
    body: [
      WRAP,
      '<p>Dear Sir/Madam,</p>',
      '<p>Please find attached the redemption statement for facility <b>{{Ref}}</b> ({{Borrower}}), showing <b>{{RedemptionAmount}}</b> to redeem in full on <b>{{RedemptionDate}}</b>.</p>',
      '{{NotesBlock}}',
      '<p>Kind regards,<br>ScotLend Group</p>',
      '</div>',
    ].join('\n'),
    html: ['NotesBlock'],
  },
};

module.exports = { TEMPLATES };
