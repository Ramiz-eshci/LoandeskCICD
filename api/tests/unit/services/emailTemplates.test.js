'use strict';

/**
 * The default templates (config/emailTemplates.js) must produce the SAME e-mail the code
 * built before Email Settings existed (client 17-10-2026). Each expected value below is the
 * old inline HTML / subject, filled with the same sample data. Whitespace between tags is
 * ignored (it does not change how the e-mail looks).
 */
jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ warn: jest.fn(), info: jest.fn() }));

const hub = require('../../../services/emailHub.service');
const { TEMPLATES } = require('../../../config/emailTemplates');
const { EVENTS, varsFor } = require('../../../config/emailEvents.config');

const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const norm = (h) => String(h).replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
const same = (a, b) => expect(norm(a)).toBe(norm(b));

const B = 'Smith & Co <Ltd>';
const ADDR = '12 High St, EH1 1AA';
const NOTE = 'Line one\nLine two';

describe('default e-mail templates = old e-mails', () => {
  it('every configurable event has a template and every template placeholder is allowed', () => {
    Object.entries(EVENTS).filter(([, e]) => !e.system).forEach(([k]) => {
      expect(TEMPLATES[k]).toBeDefined();
      expect(hub.unknownPlaceholders(k, TEMPLATES[k].subject, TEMPLATES[k].body)).toEqual([]);
      expect(varsFor(k).length).toBeGreaterThan(0);
    });
  });

  it('Indicative Terms', () => {
    const table = '<table style="x"><tr><td>Gross</td><td>£1</td></tr></table>';
    const out = hub.render('ENQUIRY_INDICATIVE', { Ref: 'ENQ-1', SecurityAddress: ADDR, RecipientName: 'Bob', ForBorrower: ` for ${B}`, FiguresTable: table });
    expect(out.subject).toBe(`Your ScotLend Indicative Terms — ENQ-1 — ${ADDR}`);
    same(out.html, `<p>Dear Bob,</p><p>Please find below the indicative figures for ${esc(B)}, subject to valuation and due diligence. The full indicative terms are also attached as a PDF.</p>${table}<p>Kind regards,<br/>ScotLend Group</p>`);
    expect(hub.render('ENQUIRY_INDICATIVE', { Ref: 'ENQ-1', SecurityAddress: '' }).subject).toBe('Your ScotLend Indicative Terms — ENQ-1');
  });

  it('Loan Offer', () => {
    const out = hub.render('ENQUIRY_OFFER', { Ref: 'ENQ-1', RecipientName: 'Bob' });
    expect(out.subject).toBe('Your ScotLend Loan Offer — ENQ-1');
    same(out.html, '<p>Hi Bob,</p>'
      + '<p>Please find attached offer and application form for the client to complete, sign and return.</p>'
      + '<p>Please ensure the client completes the asset &amp; liability section on the form.</p>'
      + '<p>Please also ensure the clients solicitor details are noted on the form.</p>'
      // Client 20-10-2026: "Please also provide" checklist added to the offer e-mail
      + '<p>Please also provide -</p>'
      + '<ul><li>Proof of photographic ID</li><li>Proof of address dated within the last 3 months (supporting document attached)</li><li>Up to date CheckMyFile credit report</li></ul>'
      + '<p>Any questions, or if I can help in any way, please let me know.</p>'
      + '<p>Kind regards,<br/>ScotLend Group</p>');
  });

  it('Revised Loan Offer', () => {
    const out = hub.render('ENQUIRY_REVISED_OFFER', { Ref: 'ENQ-1', SecurityAddress: ADDR, RecipientName: 'Bob', ForBorrower: ` for ${B}`, SecurityInBrackets: ` (${ADDR})` });
    expect(out.subject).toBe(`Revised Loan Offer — ENQ-1 — ${ADDR}`);
    same(out.html, `<p>Hi Bob,</p><p>There have been a few changes to the terms of the loan for ${esc(B)} (${ADDR}).</p>`
      + '<p>Please find attached the revised offer letter and the revised application form. Please could the client sign the new terms and return the signed copies to us.</p>'
      + '<p>Any questions, or if I can help in any way, please let me know.</p><p>Kind regards,<br/>ScotLend Group</p>');
  });

  it.each([
    ['ENQUIRY_INFO_REQUEST', 'enquiry', 'LoanDesk'],
    ['APPLICATION_INFO_REQUEST', 'application', 'LoanDesk'],
    ['UW_INFO_REQUEST', 'application', 'Underwriting Team'],
  ])('Information Required (%s)', (key, what, sign) => {
    const sec = `<p><strong>Security address:</strong> ${ADDR}</p>`;
    const list = '<ul><li>ID</li></ul>';
    const due = '<p><strong>Please respond by:</strong> 2026-10-31</p>';
    const notes = `<p><strong>Notes:</strong><br>${esc(NOTE).replace(/\n/g, '<br>')}</p>`;
    const out = hub.render(key, { Ref: 'X-1', Borrower: B, RecipientName: 'Bob', SecurityBlock: sec, RequestedItemsList: list, DueDateBlock: due, NotesBlock: notes });
    expect(out.subject).toBe('Information required - X-1');
    same(out.html, `<p>Hello Bob,</p><p>We need some further information to progress ${what} <strong>X-1</strong> for ${esc(B)}.</p>`
      + `<p><strong>Borrower:</strong> ${esc(B)}</p>${sec}<p><strong>Requested Info:</strong></p>${list}${due}${notes}<p>Many thanks,<br>${sign}</p>`);
  });

  it('Credit Deal Summary', () => {
    const td = 'padding:3px 14px 3px 0;color:#5a7394';
    const notes = '<p style="margin-top:14px"><b>Notes:</b><br>n</p>';
    const out = hub.render('APPLICATION_DEAL_SUMMARY', {
      Ref: 'APP-1', EnquiryRef: 'ENQ-1', Borrower: B, RecipientFirstName: 'Ann', SecurityLabel: 'Securities', SecurityLines: '1. a<br>2. b',
      GrossLoan: '£100.00', FileOwner: 'Bea', NotesBlock: notes, Link: 'https://x/applications/1',
    });
    expect(out.subject).toBe(`Credit Deal Summary – APP-1 – ${B}`);
    same(out.html, `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f2244">
    <p>Hi Ann,</p>
    <p>A new deal has entered the <b>Applications</b> stage and is ready for your review before it goes to underwriting.</p>
    <table style="border-collapse:collapse;font-size:13px">
      <tr><td style="${td}">Application</td><td><b>APP-1</b> (from enquiry ENQ-1)</td></tr>
      <tr><td style="${td}">Borrower</td><td>${esc(B)}</td></tr>
      <tr><td style="${td};vertical-align:top">Securities</td><td>1. a<br>2. b</td></tr>
      <tr><td style="${td}">Gross Loan</td><td>£100.00</td></tr>
      <tr><td style="${td}">File Owner</td><td>Bea</td></tr>
    </table>
    ${notes}
    <p style="margin-top:14px">The full Credit Deal Summary is attached. <a href="https://x/applications/1">Open the application in LoanDesk</a>.</p>
  </div>`);
  });

  it('Requirements Pack', () => {
    const out = hub.render('UW_REQUIREMENTS_PACK', { Ref: 'APP-1', RecipientName: 'Broker', RequirementsDetails: '<h3>Valuation</h3>' });
    expect(out.subject).toBe('Requirements Pack — APP-1');
    same(out.html, '<p>Dear Broker,</p><p>Please find attached the application form and the sanction letter for <b>APP-1</b>, together with our underwriting requirements.</p><h3>Valuation</h3><p>Kind regards,<br/>Underwriting Team</p>');
  });

  it('Final Credit Paper', () => {
    const out = hub.render('UW_FINAL_CREDIT_PAPER', { Ref: 'APP-1', Borrower: B, RecipientFirstName: 'Ann', NotesBlock: '<p>N</p>', AlsoAttachedList: '<ul><li>f</li></ul>', Link: 'https://x/u/1' });
    expect(out.subject).toBe(`Final Credit Paper – APP-1 – ${B}`);
    same(out.html, `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f2244">
      <p>Hi Ann,</p>
      <p>The <b>final Credit Deal Summary</b> for application <b>APP-1</b> (${esc(B)}) is ready for the Final Credit Committee review. The complete paper is attached.</p>
      <p>N</p><ul><li>f</li></ul>
      <p><a href="https://x/u/1">Open the case in LoanDesk</a>.</p>
    </div>`);
  });

  it('Extension Agreement', () => {
    const out = hub.render('EXTENSION_AGREEMENT', { LoanNumber: 'LN-1', RecipientName: 'Bob', NewMaturity: '31 January 2027', NotesBlock: '<p>N</p>' });
    expect(out.subject).toBe('Bridging Loan Extension Agreement – LN-1');
    same(out.html, `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f2244">
        <p>Dear Bob,</p>
        <p>Further to our conversation, please find attached the <b>Bridging Loan Extension Agreement</b> extending your facility
        LN-1 to <b>31 January 2027</b>.</p>
        <p>N</p>
        <p>Please sign and date the agreement and return a copy to us.</p>
        <p>Kind regards,<br>ScotLend Group</p></div>`);
  });

  it('Extension Request', () => {
    const td = 'padding:3px 14px 3px 0;color:#5a7394';
    const out = hub.render('EXTENSION_REQUEST', {
      Ref: 'EXT-1', LoanNumber: 'LN-1', Borrower: B, RecipientFirstName: 'Ann', ExtensionMonths: 3, NewMaturity: '31 January 2027',
      GrossLoan: '£1.00', NotesBlock: '', Link: 'https://x/e/1',
    });
    expect(out.subject).toBe(`Extension Request – EXT-1 – ${B}`);
    same(out.html, `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f2244">
        <p>Hi Ann,</p>
        <p>An extension request is ready for your decision.</p>
        <table style="border-collapse:collapse;font-size:13px">
          <tr><td style="${td}">Extension</td><td><b>EXT-1</b> (facility LN-1)</td></tr>
          <tr><td style="${td}">Borrower</td><td>${esc(B)}</td></tr>
          <tr><td style="${td}">Extension</td><td>3 month(s) to 31 January 2027</td></tr>
          <tr><td style="${td}">Gross Loan</td><td>£1.00</td></tr>
        </table>
        <p style="margin-top:14px">The Extension Request paper is attached. <a href="https://x/e/1">Open it in LoanDesk to approve or reject</a>.</p>
      </div>`);
  });

  it('Redemption Statement', () => {
    const out = hub.render('REDEMPTION_STATEMENT', { Ref: 'LN-1', Borrower: B, RedemptionAmount: '£250,000.00', RedemptionDate: '30 November 2026', NotesBlock: '' });
    expect(out.subject).toBe(`Redemption Statement – LN-1 – ${B}`);
    same(out.html, `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f2244">
      <p>Dear Sir/Madam,</p>
      <p>Please find attached the redemption statement for facility <b>LN-1</b> (${esc(B)}),
      showing <b>£250,000.00</b> to redeem in full on <b>30 November 2026</b>.</p>
      <p>Kind regards,<br>ScotLend Group</p></div>`);
  });

  it('a custom body gets the same blocks raw and plain values escaped', async () => {
    const db = require('../../../config/database');
    hub.invalidate();
    db.query
      .mockResolvedValueOnce([{ include_default_cc: true, subject_template: null, body_template: '<p>Hi {{RecipientName}}</p>{{SecurityBlock}}' }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await hub.prepare({
      event: 'UW_INFO_REQUEST', ref: { module: 'UNDERWRITING', id: 1 }, to: ['a@x.com'], cc: [], subject: 's', html: 'h',
      vars: { RecipientName: '<b>', SecurityBlock: '<p>S</p>' },
    });
    expect(out.html).toBe('<p>Hi &lt;b&gt;</p><p>S</p>');
  });
});
