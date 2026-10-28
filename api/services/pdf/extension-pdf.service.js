'use strict';

/**
 * Extension documents (client 30-09-2026) - both built from the portfolio facility +
 * the extension record, never hard-coded case data:
 *
 *   buildExtensionAgreementPdf  "Bridging Loan Extension Agreement" sent to the borrower to
 *                               sign and return. Same ScotLend letterhead / Carlito body as
 *                               the offer letter. Wording follows the client's template
 *                               (Extension_Agreement.docx); the Additional Terms lines adapt
 *                               to % or £ fees and serviced or retained interest / fees.
 *   buildExtensionRequestPdf    "Extension Request" - the mini credit paper for the bosses
 *                               (Head of Extension), modelled on the Credit Deal Summary
 *                               (Extension_Request.docx).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'offer');
const asset = (f) => { const p = path.join(ASSETS, f); return fs.existsSync(p) ? p : null; };

/** Lender block printed on the agreement (registered office per the client template). */
const LENDER = {
  name: 'ScotLend Group',
  address: 'Suite 15, Calder House, 8 South Caldeen Road, Coatbridge, ML5 4EG',
};

const NAVY = '#0A1D3C';
const GOLD = '#c79a4b';

const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
/** £2,788.75 (always 2 dp) */
const gbp = (v) => {
  const n = num(v) || 0;
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
/** £242,500 for whole pounds, £242,500.50 otherwise (as the client template prints). */
const money = (v) => {
  const n = num(v) || 0;
  const dp = Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2;
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
const pc = (v) => { const n = num(v); return n === null ? '' : `${Math.round(n * 1000) / 1000}%`; };
const iso = (v) => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (d) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = d % 100;
  return d + (s[(v - 20) % 10] || s[v] || s[0]);
};
/** 2026-10-01 -> "1st October 2026" */
const longDate = (v) => {
  const m = iso(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${ordinal(Number(m[3]))} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};
/** 2026-10-01 -> "01/10/2026" */
const dmy = (v) => {
  const m = iso(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const join = (parts, sep = '\n') => parts.filter((x) => x !== null && x !== undefined && String(x).trim() !== '').join(sep);

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Human wording for the fee lines (shared by agreement, paper and UI summaries). */
function feeText(kind, x, newMaturity) {
  const label = kind === 'ext' ? 'Extension fee' : 'Extension Documentation/ Administration fee';
  const type = kind === 'ext' ? x.ext_fee_type : x.doc_fee_type;
  const value = kind === 'ext' ? x.ext_fee_value : x.doc_fee_value;
  const amount = kind === 'ext' ? x.ext_fee_amount : x.doc_fee_amount;
  const timing = kind === 'ext' ? x.ext_fee_timing : x.doc_fee_timing;
  const due = kind === 'ext' ? x.ext_fee_due_date : x.doc_fee_due_date;
  if (!(num(amount) > 0)) return null;
  const what = type === 'PCT'
    ? `${label} of ${pc(value)} of the initial gross loan, which equates to ${money(amount)}`
    : `${label} of ${money(amount)}`;
  if (timing === 'Retained') {
    // Client 28-10-2026: a retained fee is added to the gross loan (and accrues interest with it).
    return `${what} that will be retained and added to the gross loan, payable at the end of the extension, on or before ${longDate(newMaturity) || 'the Extension Date'}.`;
  }
  return `${what} ${kind === 'ext' ? 'that will be paid' : 'to be paid'} on or before ${longDate(due) || 'the start of the extension'}.`;
}

function interestText(x) {
  const mi = num(x.monthly_interest);
  if (!(mi > 0)) return null;
  const from = longDate(x.current_maturity);
  const to = longDate(x.new_maturity);
  if (x.interest_treatment === 'Retained') {
    const total = mi * (Number(x.extension_months) || 0);
    return `Interest from ${from} to the ${to} of ${gbp(mi)} a month (${gbp(total)} in total) will be retained and is payable in full at the end of the extension, on or before ${to}.`;
  }
  return `Interest from ${from} to the ${to} of ${gbp(mi)} a month has to be serviced monthly with the first payment being made on the ${longDate(x.first_payment_date || x.current_maturity)}.`;
}

/**
 * "with a security address of A" / "with security addresses of A and B" - every security
 * (client 27-10-2026; was the first one only). x.security_lines, else x.security_address.
 */
function securityPhrase(x) {
  const lines = Array.isArray(x.security_lines) && x.security_lines.length
    ? x.security_lines
    : String(x.security_address || '').split('\n').map((s) => s.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
  if (lines.length <= 1) return `with a security address of ${lines[0] || '-'}`;
  return `with security addresses of ${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}`;
}

/**
 * Bridging Loan Extension Agreement.
 * @param {object} x  extension row + facility fields:
 *   borrower_name, security_address, agreement_date, original_date (loan start), gross_amount,
 *   net_amount, current_maturity, new_maturity, extension_months, monthly_interest, interest_treatment,
 *   first_payment_date, ext_fee_*, doc_fee_*
 */
async function buildExtensionAgreementPdf(x = {}) {
  const TXT = '#1F497D';
  const GOLDC = '#CCAA6D';
  const NAVYC = '#0A1D3C';
  const HEADER_IMG = asset('offer-header-centred.png') || asset('offer-header.png');
  const FOOTER_IMG = asset('offer-footer.png');
  const HEADER_H = 124;
  const FOOTER_H = 28.3;

  const doc = new PDFDocument({ size: 'A4', margins: { top: 42, bottom: 55, left: 50, right: 50 } });
  const PW = doc.page.width;
  const PH = doc.page.height;
  const L = 50;
  const W = PW - 100;

  let REG = 'Helvetica';
  let BOLD = 'Helvetica-Bold';
  let SIZE = 10;
  const fReg = asset('Carlito-Regular.ttf');
  const fBold = asset('Carlito-Bold.ttf');
  if (fReg && fBold) {
    doc.registerFont('Body', fReg);
    doc.registerFont('Body-Bold', fBold);
    REG = 'Body'; BOLD = 'Body-Bold'; SIZE = 11;
  }

  if (HEADER_IMG) doc.image(HEADER_IMG, 0, 0, { width: PW, height: HEADER_H });
  else {
    doc.rect(0, 0, PW, 11).fill('#132A4F');
    doc.rect(37, 40, PW - 74, 67).fill(NAVYC);
    doc.font('Helvetica-Bold').fontSize(26).fillColor(GOLDC).text('ScotLend', 47, 55);
  }
  const drawFooter = () => {
    const y = PH - FOOTER_H;
    if (FOOTER_IMG) doc.image(FOOTER_IMG, 0, y, { width: PW, height: FOOTER_H });
    else doc.rect(0, y + 11, PW, FOOTER_H - 11).fill(GOLDC);
  };
  doc.on('pageAdded', () => { drawFooter(); doc.y = doc.page.margins.top; });
  doc.y = 150;

  const font = (b) => doc.font(b ? BOLD : REG).fontSize(SIZE).fillColor(TXT);
  /** Paragraph that starts with a bold lead-in ("THE PARTIES.") followed by body text. */
  const lead = (head, body, gap = 1) => {
    font(true);
    doc.text(head + ' ', L, doc.y, { width: W, align: 'justify', continued: !!body });
    if (body) { font(false); doc.text(body, { width: W, align: 'justify' }); }
    doc.moveDown(gap);
  };
  const P = (t, opt = {}) => { font(!!opt.bold); doc.text(t, opt.x || L, doc.y, { width: opt.w || W, align: opt.align || 'justify' }); doc.moveDown(opt.gap != null ? opt.gap : 1); };

  font(true);
  doc.fontSize(SIZE + 5).text('Bridging Loan Extension Agreement', L, doc.y, { width: W, align: 'center', underline: true });
  doc.moveDown(1.2);

  lead('THE PARTIES.', `This Bridging Loan Extension Agreement (“Agreement”) made ${longDate(x.agreement_date) || longDate(new Date())}, between:`);
  P(`Lender: ${LENDER.name}, with a registered office address of ${LENDER.address}. (“Lender”) and`, { x: L + 18, w: W - 18 });
  P(`Borrower: ${x.borrower_name || '-'}, ${securityPhrase(x)} (“Borrower”).`, { x: L + 18, w: W - 18 });
  P('HEREINAFTER the Borrower and Lender shall be referred together as the “Parties” and in consideration of the covenants herein contained agree as follows:');

  lead('ORIGINAL NOTE.', `It is known that this Agreement is amending a note that exists between the Parties signed on ${longDate(x.original_date) || '-'} for the sum of ${money(x.gross_amount)} (Gross)${num(x.net_amount) ? `, ${money(x.net_amount)} (Net)` : ''} and maturing on ${longDate(x.current_maturity) || '-'} (“Original Note”).`);
  lead('EXTENSION.', `Under this Agreement, the Parties agreed to further extend the maturity date as stated in the Original Note to ${longDate(x.new_maturity) || '-'} (“Extension Date”).`);
  lead('ADDITIONAL TERMS.', 'The Parties agree that all other terms and conditions stated in the Original Note shall remain in full force and effect except:', 0.6);

  const terms = [interestText(x), feeText('ext', x, x.new_maturity), feeText('doc', x, x.new_maturity)].filter(Boolean);
  if (!terms.length) terms.push('No additional terms.');
  for (const t of terms) {
    font(false);
    const y = doc.y;
    doc.text('•', L + 18, y, { width: 12, lineBreak: false });
    doc.text(t, L + 34, y, { width: W - 34, align: 'justify' });
    doc.moveDown(0.6);
  }
  doc.moveDown(0.6);

  P('IN WITNESS WHEREOF, the Parties have indicated their acceptance of the terms of this Agreement by their signatures below on the dates indicated.');
  if (doc.y > PH - 170) doc.addPage();
  doc.moveDown(1.5);
  font(false);
  doc.text('Borrower’s Signature: ____________________________     Date: _______________', L, doc.y, { width: W });
  doc.moveDown(2.5);
  doc.text('Lender’s Signature: ____________________________     Date: ' + (dmy(x.agreement_date) || '_______________'), L, doc.y, { width: W });

  return toBuffer(doc);
}

/**
 * Extension Request - mini credit paper for the Head of Extension.
 * Client 27-10-2026: laid out like the Credit Paper (Credit Deal Summary PDF) - same header
 * (File Owner / Underwriter, no grey meta line), table, every security address with its
 * Google Maps link, narrative rows in the table and the Introducer block at the bottom.
 * @param {object} x      extension + facility fields (see agreement) + loan_number, product, rate,
 *                        security_maps [{ address, url }], underwriter_name, introducer
 * @param {object} paper  editable paper fields (doc_json): case_owner, funding_line, borrower_name,
 *                        borrower_background, security_address, purchase_info, title_number, value_text,
 *                        valuation_type, valuer, site_visit, deal_type, property_description,
 *                        extension_request, credit_recommendation
 */
async function buildExtensionRequestPdf(x = {}, paper = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const LEFT = 40;
  const RIGHT = doc.page.width - 40;
  const W = RIGHT - LEFT;
  const LABEL_W = 160;
  const BOTTOM = doc.page.height - 50;
  const ensure = (h) => { if (doc.y + h > BOTTOM) doc.addPage(); };
  const LOGO = asset('scotlend-logo.png');

  const BAND_H = 56;
  doc.rect(0, 0, doc.page.width, BAND_H).fill(NAVY);
  if (LOGO) { const LH = 42; const LW = LH * (840 / 266); doc.image(LOGO, (doc.page.width - LW) / 2, (BAND_H - LH) / 2, { width: LW, height: LH }); }
  else doc.fillColor(GOLD).fontSize(18).font('Helvetica-Bold').text('ScotLend Group', 0, 18, { width: doc.page.width, align: 'center' });
  doc.y = 70;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text('Credit Deal Summary – Extension Request', LEFT, doc.y, { width: W, underline: true });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(`File Owner – ${paper.case_owner || '-'}`, LEFT, doc.y, { underline: true });
  doc.moveDown(0.15);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(`Underwriter – ${x.underwriter_name || '-'}`, LEFT, doc.y, { underline: true });
  doc.moveDown(0.8);

  const table = (rows) => {
    rows.filter(Boolean).forEach(([label, value], i) => {
      const val = value === null || value === undefined || String(value).trim() === '' ? '-' : String(value);
      doc.font('Helvetica').fontSize(9);
      const hVal = doc.heightOfString(val, { width: W - LABEL_W - 12 });
      doc.font('Helvetica-Bold').fontSize(9);
      const hLab = doc.heightOfString(label, { width: LABEL_W - 12 });
      const h = Math.max(hVal, hLab) + 10;
      ensure(h);
      const y = doc.y;
      if (i === 0) doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#9aa7b8').lineWidth(0.6).stroke();
      doc.rect(LEFT, y, LABEL_W, h).fill('#eef2f8');
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(label, LEFT + 6, y + 5, { width: LABEL_W - 12 });
      doc.fillColor('#000000').font('Helvetica').fontSize(9).text(val, LEFT + LABEL_W + 6, y + 5, { width: W - LABEL_W - 12 });
      doc.moveTo(LEFT, y + h).lineTo(RIGHT, y + h).strokeColor('#9aa7b8').lineWidth(0.6).stroke();
      doc.moveTo(LEFT, y).lineTo(LEFT, y + h).stroke();
      doc.moveTo(LEFT + LABEL_W, y).lineTo(LEFT + LABEL_W, y + h).stroke();
      doc.moveTo(RIGHT, y).lineTo(RIGHT, y + h).stroke();
      doc.y = y + h;
    });
    doc.moveDown(0.9);
  };
  const heading = (t) => { ensure(40); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(t, LEFT, doc.y, { underline: true }); doc.moveDown(0.35); };
  // x.security_address is the resolved list (every security); paper's own value as fallback.
  const addresses = x.security_address || paper.security_address;

  heading('Deal');
  table([
    ['Funding Line:', paper.funding_line],
    ['Borrower:', paper.borrower_name || x.borrower_name],
    ['Borrower Background & Experience:', paper.borrower_background],
    ['Security Property Address(s):', join([addresses, paper.purchase_info, paper.title_number])],
    ['Value:', paper.value_text],
    ['Valuation Type:', paper.valuation_type],
    ['Valuer:', paper.valuer],
    ['Site Visit:', paper.site_visit],
    ['Deal Type:', paper.deal_type],
    ['Property Description:', paper.property_description],
  ]);

  // A clickable Google Maps link per security, as on the Credit Paper.
  const maps = Array.isArray(x.security_maps) ? x.security_maps.filter((m) => m && m.url) : [];
  if (maps.length) {
    heading(maps.length > 1 ? 'Security Locations' : 'Security Location');
    maps.forEach((m, i) => {
      ensure(30);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
        .text(maps.length > 1 ? `${i + 1}. ${m.address}` : m.address, LEFT, doc.y, { width: W });
      doc.font('Helvetica').fontSize(8.5).fillColor('#1a56db')
        .text('Open in Google Maps', LEFT, doc.y, { link: m.url, underline: true });
      doc.moveDown(0.6);
    });
    doc.fillColor('#000000');
    doc.moveDown(0.3);
  }

  const mi = num(x.monthly_interest);
  heading('Extension Terms');
  table([
    ['Facility:', x.loan_number],
    ['Original Loan:', join([`${money(x.gross_amount)} Gross`, num(x.net_amount) ? `${money(x.net_amount)} Net` : null], ' / ')],
    ['Interest Rate:', num(x.monthly_rate_pct) ? `${pc(x.monthly_rate_pct)} pm` : ''],
    ['Current Maturity:', longDate(x.current_maturity)],
    ['Extension Requested:', `${Number(x.extension_months) || 0} month${Number(x.extension_months) === 1 ? '' : 's'}`],
    ['New Maturity (Extension Date):', longDate(x.new_maturity)],
    ['Security Address(s):', addresses],
    ['Interest During Extension:', mi ? `${gbp(mi)} per month – ${x.interest_treatment === 'Retained' ? 'retained to the end' : 'serviced monthly'}` : ''],
    ['Extension Fee:', num(x.ext_fee_amount) ? `${x.ext_fee_type === 'PCT' ? pc(x.ext_fee_value) + ' of gross = ' : ''}${gbp(x.ext_fee_amount)}` : 'None'],
    ['Document Fee:', num(x.doc_fee_amount) ? `${x.doc_fee_type === 'PCT' ? pc(x.doc_fee_value) + ' of gross = ' : ''}${gbp(x.doc_fee_amount)}` : 'None'],
    ['Exit Plan / Evidence:', x.exit_plan],
  ]);

  // Narrative rows in the table, like the Credit Paper's Risk mitigants / Credit Recommendation.
  table([['Extension Request:', paper.extension_request], ['Credit Recommendation:', paper.credit_recommendation]]);

  heading('Credit Committee Use Only:');
  table([['Decision:', '[  ] Approve        [  ] Reject'], ['Date:', '____ / ____ / ________']]);

  // Introducer block at the bottom, as on the Credit Paper.
  if (x.introducer && x.introducer.name) {
    ensure(50);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000');
    doc.text(`Introducer – ${x.introducer.name}`, LEFT, doc.y);
    doc.text(`Introducer email – ${x.introducer.email || '-'}`, LEFT, doc.y);
    doc.text(`Introducer contact number/s – ${x.introducer.phone || '-'}`, LEFT, doc.y);
  }

  return toBuffer(doc);
}

module.exports = { buildExtensionAgreementPdf, buildExtensionRequestPdf, feeText, interestText, longDate, LENDER };
