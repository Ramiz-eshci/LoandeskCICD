'use strict';

/**
 * Redemption Statement PDF (client 30-09-2026: "formatted properly like the others").
 * Same ScotLend letterhead, footer strip and Calibri-metric body (Carlito) as the
 * offer letter / Extension Agreement. Built on demand - it is e-mailed, not saved
 * to the facility documents.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'offer');
const asset = (f) => { const p = path.join(ASSETS, f); return fs.existsSync(p) ? p : null; };

const TXT = '#1F497D';
const NAVY = '#0A1D3C';
const GOLD = '#CCAA6D';

const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
const gbp = (v) => '£' + (num(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));
const longDate = (v) => {
  const m = iso(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = Number(m[3]);
  const suf = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
  return `${d}${suf} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * @param {object} f  figures + facility:
 *   loan_number, borrower_name, borrower_address, security_address, start_date, maturity_date,
 *   redemption_date, statement_date, interest_basis ('daily'|'monthly'), days_elapsed, months_charged,
 *   monthly_interest, daily_interest, principal_amount, accrued_interest, min_interest_months,
 *   min_interest_adj, exit_fee, other_fees, credits, total_amount, reference
 */
async function buildRedemptionStatementPdf(f = {}) {
  const HEADER_IMG = asset('offer-header-centred.png') || asset('offer-header.png');
  const FOOTER_IMG = asset('offer-footer.png');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 42, bottom: 55, left: 50, right: 50 } });
  const PW = doc.page.width;
  const PH = doc.page.height;
  const L = 50;
  const W = PW - 100;

  let REG = 'Helvetica'; let BOLD = 'Helvetica-Bold'; let SIZE = 10;
  const fr = asset('Carlito-Regular.ttf'); const fb = asset('Carlito-Bold.ttf');
  if (fr && fb) { doc.registerFont('Body', fr); doc.registerFont('Body-Bold', fb); REG = 'Body'; BOLD = 'Body-Bold'; SIZE = 11; }

  if (HEADER_IMG) doc.image(HEADER_IMG, 0, 0, { width: PW, height: 124 });
  else { doc.rect(0, 0, PW, 90).fill(NAVY); doc.font('Helvetica-Bold').fontSize(24).fillColor(GOLD).text('ScotLend', L, 32); }
  const footer = () => { const y = PH - 28.3; if (FOOTER_IMG) doc.image(FOOTER_IMG, 0, y, { width: PW, height: 28.3 }); };
  doc.on('pageAdded', () => { footer(); doc.y = doc.page.margins.top; });
  doc.y = 146;

  const font = (b, size) => doc.font(b ? BOLD : REG).fontSize(size || SIZE).fillColor(TXT);
  const KV = (label, value) => {
    const y = doc.y;
    font(true); doc.text(label, L, y, { width: 90, lineBreak: false });
    font(false); doc.text(value || '-', L + 95, y, { width: W - 95 });
    doc.moveDown(0.35);
  };

  KV('NAME:', f.borrower_name);
  KV('ADDRESS:', f.borrower_address || f.security_address);
  KV('DATE:', longDate(f.statement_date || new Date()));
  KV('FACILITY:', f.loan_number + (f.reference ? `   (Ref ${f.reference})` : ''));
  doc.moveDown(0.8);

  font(true, SIZE + 5);
  doc.text('Redemption Statement', L, doc.y, { width: W, align: 'center', underline: true });
  doc.moveDown(0.8);

  font(false);
  doc.text(`Further to your request, please find below the amount required to redeem the above facility in full on ${longDate(f.redemption_date)}.`, L, doc.y, { width: W, align: 'justify' });
  doc.moveDown(0.8);
  if (f.security_address) {
    font(true); doc.text('Security: ', L, doc.y, { continued: true }); font(false); doc.text(f.security_address, { width: W });
    doc.moveDown(0.8);
  }

  // Figures table
  const basisTxt = f.interest_basis === 'monthly'
    ? `${f.months_charged} month${Number(f.months_charged) === 1 ? '' : 's'} (full months) at ${gbp(f.monthly_interest)} per month`
    : `${f.days_elapsed} day${Number(f.days_elapsed) === 1 ? '' : 's'} at ${gbp(f.daily_interest)} per day`;
  // Client 20-10-2026: principal already repaid -> no principal line; part-paid -> say so.
  const rows = [];
  if (!f.principal_paid_off) {
    rows.push([num(f.amount_paid) > 0 ? `Outstanding principal (after ${gbp(f.amount_paid)} paid)` : 'Outstanding principal', gbp(f.principal_amount)]);
  }
  // Client 23-10-2026: inside the minimum term the interest is the fixed minimum (N months).
  if (f.min_interest_applies) rows.push([`Minimum interest – ${f.min_interest_months} months at ${gbp(f.monthly_interest)} per month`, gbp(f.accrued_interest)]);
  else rows.push([`Accrued interest – ${basisTxt}`, gbp(f.accrued_interest)]);
  if (num(f.min_interest_adj) > 0) rows.push([`Minimum interest adjustment (minimum ${f.min_interest_months} months' interest)`, gbp(f.min_interest_adj)]);
  // Order (client 09-10-2026): Principal, Accrued, Minimum, Other Fees, Exit Fee.
  if (num(f.other_fees) > 0) rows.push(['Other fees (document, broker, arrangement)', gbp(f.other_fees)]);
  rows.push(["Exit fee (1 month's interest on the outstanding amount)", gbp(f.exit_fee)]);
  if (num(f.credits) > 0) rows.push(['Less: credits', '-' + gbp(f.credits)]);

  const VAL_W = 130;
  const drawRow = (label, value, opt = {}) => {
    font(!!opt.bold, opt.size);
    const h = Math.max(doc.heightOfString(label, { width: W - VAL_W - 16 }), 14) + 10;
    if (doc.y + h > PH - 80) doc.addPage();
    const y = doc.y;
    if (opt.fill) doc.rect(L, y, W, h).fill(opt.fill);
    font(!!opt.bold, opt.size);
    if (opt.color) doc.fillColor(opt.color);
    doc.text(label, L + 8, y + 5, { width: W - VAL_W - 16 });
    doc.text(value, L + W - VAL_W - 8, y + 5, { width: VAL_W, align: 'right' });
    doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.6).strokeColor('#d6dde8').stroke();
    doc.y = y + h;
  };
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1.2).strokeColor(GOLD).stroke();
  rows.forEach(([l, v]) => drawRow(l, v));
  drawRow('TOTAL REDEMPTION AMOUNT', gbp(f.total_amount), { bold: true, size: SIZE + 1, fill: '#eef2f8', color: NAVY });
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1.2).strokeColor(GOLD).stroke();
  doc.moveDown(1);

  font(false, SIZE - 1);
  const notes = [];
  notes.push(f.interest_basis === 'monthly'
    ? 'Interest is charged for each month, or part of a month, from the start of the facility to the redemption date.'
    : 'Interest is charged day by day from the start of the facility to the redemption date.');
  if (num(f.min_interest_months) > 0) {
    notes.push(`A minimum of ${f.min_interest_months} months' interest is payable on this facility${num(f.min_interest_adj) > 0 ? '; the adjustment above brings the interest up to that minimum' : ''}.`);
  }
  notes.push(`This figure is valid for redemption on ${longDate(f.redemption_date)} only. If funds are received after this date, further interest of ${gbp(f.daily_interest)} per day will be due – please contact us for an updated figure.`);
  notes.forEach((t) => { doc.text(t, L, doc.y, { width: W, align: 'justify' }); doc.moveDown(0.5); });

  doc.moveDown(1);
  font(false); doc.text('Kind regards,', L, doc.y);
  font(true); doc.text('ScotLend Group', L, doc.y);

  return toBuffer(doc);
}

module.exports = { buildRedemptionStatementPdf, longDate };
