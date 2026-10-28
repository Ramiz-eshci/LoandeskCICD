'use strict';

/**
 * PDF generation for Module-4 (indicative terms table + official offer letter)
 * using PDFKit (built-in Helvetica fonts, no external font files needed).
 * Each builder returns a Promise<Buffer>.
 */

const PDFDocument = require('pdfkit');

const NAVY = '#0d2340';
const GOLD = '#c79a4b';
const GREY = '#666666';

const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pct = (n) => (n === null || n === undefined || n === '' ? '-' : `${Number(n).toFixed(2)}%`);

/**
 * The one date format for every LoanDesk document: dd-mm-yyyy.
 * Accepts a Date, an ISO string, or a SQL datetime. Returns '' for anything
 * unusable so a blank field never prints "Invalid Date".
 * Date-only strings are split by hand rather than parsed, so a '2026-09-15'
 * never shifts a day because the server is behind UTC.
 */
function fmtDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

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
 * "Where is the money secured" line for letters + emails: property address,
 * plus the postcode when the address does not already carry it.
 */
/** One "address, postcode" string, postcode dropped when already inside the address. */
function oneSecAddress(addr, pc) {
  const a = String(addr || '').trim();
  const p = String(pc || '').trim();
  if (!a) return p;
  if (!p || a.toUpperCase().replace(/\s/g, '').includes(p.toUpperCase().replace(/\s/g, ''))) return a;
  return `${a}, ${p}`;
}

function securityAddress(e = {}) {
  return oneSecAddress(e && e.property_address, e && e.postcode);
}

/**
 * Every security address for an enquiry, comma-separated and de-duplicated: the main
 * property plus each "other security" entered on the enquiry (Step 5, e.additional_securities)
 * and/or ticked on the Send Indicatives popup (calc.additional_securities). Used for the
 * indicative email "Security:" line and the PDF "Security Address:" line so a multi-security
 * deal lists them all (client 02-10-2026), not just the main property.
 */
function securityAddressList(e = {}, calc = {}) {
  const out = [];
  const seen = new Set();
  // Dedup on the ADDRESS LINE only (postcode stripped). The same security can arrive
  // once from the enquiry (address + separate postcode) and once from the indicative
  // calc (address only, no postcode) — keying on the full "address, postcode" string
  // let both through and listed the security twice (client 09-10-2026).
  const push = (addr, pc) => {
    const a = String(addr || '').trim();
    if (!a) return;
    const key = a.toUpperCase().replace(/[\s,]/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(oneSecAddress(a, pc));
  };
  push(e && e.property_address, e && e.postcode);
  const fromEnquiry = Array.isArray(e && e.additional_securities) ? e.additional_securities : [];
  const fromCalc = Array.isArray(calc && calc.additional_securities) ? calc.additional_securities : [];
  [...fromEnquiry, ...fromCalc].forEach((x) => {
    if (!x) return;
    push(x.address || x.description, x.postcode);
  });
  return out;
}
// Comma-joined form, kept for single-line callers.
function securityAddresses(e = {}, calc = {}) {
  return securityAddressList(e, calc).join(', ');
}

// Centred ScotLend Group logo banner (client request) - the logo is cropped from the
// offer letterhead, gold on navy; the band uses the logo's own navy so it blends in.
const LOGO_NAVY = '#0A1D3C';
const LOGO_PATH = (() => {
  const p = require('path').join(__dirname, '..', '..', 'assets', 'offer', 'scotlend-logo.png');
  return require('fs').existsSync(p) ? p : null;
})();
const LOGO_RATIO = 840 / 266; // scotlend-logo.png is 840 x 266

function header(doc, subtitle) {
  const BAND_H = 70;
  doc.rect(0, 0, doc.page.width, BAND_H).fill(LOGO_NAVY);
  if (LOGO_PATH) {
    const LOGO_H = 52;
    const LOGO_W = LOGO_H * LOGO_RATIO;
    doc.image(LOGO_PATH, (doc.page.width - LOGO_W) / 2, (BAND_H - LOGO_H) / 2, { width: LOGO_W, height: LOGO_H });
  } else {
    // Fallback if the image is missing: the name as text, still centred.
    doc.fillColor(GOLD).fontSize(24).font('Helvetica-Bold')
      .text('ScotLend Group', 0, 22, { width: doc.page.width, align: 'center' });
  }
  doc.moveDown(2);
  doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold').text(subtitle, 50, 90);
  doc.moveTo(50, 112).lineTo(doc.page.width - 50, 112).strokeColor(GOLD).lineWidth(2).stroke();
  doc.moveDown(1.5);
  doc.fillColor('#000000').lineWidth(1);
}

/** Two-column key/value row helper. */
function row(doc, label, value, opts = {}) {
  const y = doc.y;
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10)
    .fillColor(opts.color || '#000000');
  doc.text(label, 55, y, { width: 320 });
  // A label that wraps to two lines must not be overwritten by the next row:
  // both columns start at the same y, so carry on from whichever ran longer.
  const afterLabel = doc.y;
  doc.text(value, 375, y, { width: doc.page.width - 375 - 55, align: 'right' });
  doc.y = Math.max(afterLabel, doc.y);
  doc.moveDown(0.6);
  if (opts.rule) {
    doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
    doc.moveDown(0.4);
  }
}

/**
 * THE indicative line items — one definition shared by the PDF and the email so
 * the applicant always receives exactly what the BDM saw in the Send Indicatives
 * popup. Every row is pre-formatted text.
 *
 * Flags: `bold` heavier label + value, `net` the red headline figures,
 *        `rule` a hairline under the row (PDF only).
 * @param {object} calc output of computeIndicative().calc
 * @returns {{label: string, value: string, bold?: boolean, net?: boolean, rule?: boolean}[]}
 */
function indicativeRows(calc = {}) {
  const c = calc || {};
  const ctype = c.calc_type || 'dds';
  const itype = c.interest_type || 'Retained';
  const wp = (p) => (p !== null && p !== undefined && p !== '' ? ` (${p}%)` : '');
  const gbp = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '-' : '£' + money(n));
  const rows = [];
  const add = (label, value, opt) => rows.push(Object.assign({ label, value }, opt || {}));
  // Amount mode: the BDM typed the loan, so it is the LTV actually taken, not a maximum.
  // NET model (29-09-2026): always "Max LTV", in % and £ mode alike.
  const NET = c.value_model === 'net';
  const LTV_LBL = NET || c.ltv_mode !== 'amount' ? 'Max LTV' : 'LTV';
  // Security block: plain "Property Value", or - with other securities ticked -
  // the main property, each additional security, and the total the LTV works off.
  const adds = Array.isArray(c.additional_securities) ? c.additional_securities : [];
  const hasAdds = adds.length > 0;
  const addSecurityRows = () => {
    if (NET) {
      // Client 29-09-2026: one "Property Value" line only (the value the LTV works off —
      // all securities less outstanding loans / 2nd charges). No Total / after-loans rows.
      add('Property Value', gbp(c.net_property_value != null ? c.net_property_value : c.property_value));
      return;
    }
    if (!hasAdds) { add('Property Value', gbp(c.property_value)); return; }
    add('Main Security Value', gbp(c.main_property_value));
    adds.forEach((x, i) => {
      // Client 09-10-2026: the address already appears on the "Security Address" line above,
      // so the per-security figure row shows only its type — no repeated address.
      const what = x.security_type ? String(x.security_type) : '';
      add(`Additional Security ${i + 1}${what ? ': ' + what : ''}`, gbp(x.value));
      if (x.existing_charge) add(`   Existing charge on Additional Security ${i + 1}`, gbp(x.existing_charge));
    });
    add('Total Security Value', gbp(c.total_security_value != null ? c.total_security_value : c.property_value), { bold: true });
  };
  const CHG_LBL = hasAdds && c.additional_securities_charges ? 'Existing Charges (all securities)' : null;
  // Charges already taken off the Property Value in the NET model - no second row.
  const SHOW_CHG = !NET && !!c.first_charge;

  // Header block: the popup's calculator + interest type + term, which the
  // figures alone do not carry.
  const CALC_NAME = {
    dds: 'Retained with drawdowns', bridge: 'Retained with 1st charge',
    second_charge: 'Retained with 2nd charge', serviced: 'Serviced Monthly',
  };
  // Client 30-09-2026: the "Calculator" row is now "Interest Type" (popup, PDF, e-mail) -
  // it names the calculator used, e.g. "Retained with drawdowns" / "Serviced Monthly".
  add('Interest Type', CALC_NAME[ctype] || CALC_NAME.dds);
  add('Term', c.term_months != null ? `${c.term_months} months` : '-', { rule: true });

  if (ctype === 'bridge' || ctype === 'second_charge' || ctype === 'serviced') {
    addSecurityRows();
    add(`${LTV_LBL}${wp(c.ltv_pct)}`, gbp(c.max_ltv), { rule: true });
    if (ctype !== 'second_charge' && SHOW_CHG) add(CHG_LBL || 'Existing Charges', gbp(c.first_charge));
    if (ctype === 'second_charge') {
      if (!NET) add(CHG_LBL || '1st Charge', gbp(c.first_charge));
      add('Gross Loan', gbp(c.base_gross), { bold: true, rule: true });
    } else {
      add('Total Gross Loan', gbp(c.base_gross), { bold: true, rule: true });
    }
    if (ctype !== 'serviced') add(`Monthly Rate${wp(c.retained_interest_day1_rate_pct)}`, gbp(c.monthly_interest));
    add(`Arrangement Fee${c.arrangement_fee_is_pct !== false ? wp(c.arrangement_fee_pct) : ''}`, gbp(c.arrangement_fee));
    add(`Broker Fee${c.broker_fee_is_pct !== false ? wp(c.broker_fee_pct) : ''}`, gbp(c.broker_fee));
    add('Document Fee', gbp(c.document_fee), { rule: true });
    if (ctype !== 'serviced') {
      add(`${ctype === 'second_charge' ? 'Retained Interest Months' : 'Retained Interest'} (${c.term_months != null ? c.term_months : '-'})`,
        gbp(c.retained_interest_day1), { rule: true });
    }
    add('Total Deductions', gbp(c.day1_total_deductions), { bold: true, rule: true });
    add('Total Net', gbp(c.day1_net), { bold: true, net: true, rule: true });
    if (ctype === 'serviced') {
      add(`Monthly Interest${wp(c.retained_interest_day1_rate_pct)}`, gbp(c.monthly_payment), { bold: true });
      if (c.annual_rate_pct != null) add('Interest calc annual rate', pct(c.annual_rate_pct));
    }
    return rows;
  }

  // "Calc with DDs" layout — same rows, same order as the popup.
  addSecurityRows();
  add('LTV', pct(c.ltv_pct), { bold: true }); // LTV used (from the enquiry / typed), 30-09-2026
  if (c.gdv !== null && c.gdv !== undefined) add('GDV', gbp(c.gdv));
  if (c.ltgdv_pct !== null && c.ltgdv_pct !== undefined) add('LTGDV', pct(c.ltgdv_pct), { rule: true });
  add(`${LTV_LBL}${wp(c.ltv_pct)}`, gbp(c.max_ltv));
  if (SHOW_CHG) add(CHG_LBL || 'Existing 1st Charge', gbp(c.first_charge));
  add('Total Gross Loan incl DDs', gbp(c.total_gross_loan_incl_dds), { bold: true, rule: true });
  add(`Arrangement Fee${c.arrangement_fee_is_pct !== false ? wp(c.arrangement_fee_pct) : ''}`, gbp(c.arrangement_fee));
  add(`Broker Fee${c.broker_fee_is_pct !== false ? wp(c.broker_fee_pct) : ''}`, gbp(c.broker_fee));
  add('Document Fee', gbp(c.document_fee), { rule: true });
  if (itype === 'Retained') {
    add(`Retained Interest Day 1${wp(c.retained_interest_day1_rate_pct)}`, gbp(c.retained_interest_day1));
    add('Retained Interest Total', gbp(c.retained_interest_total), { rule: true });
  }
  add('Day 1 Total Deductions', gbp(c.day1_total_deductions), { bold: true, rule: true });
  add('Day 1 Net', gbp(c.day1_net), { bold: true, net: true, rule: true });
  // Each drawdown, then the total — printed even with no drawdowns typed,
  // exactly as the "Calc with DDs" sheet does (it then equals Day 1 Net).
  const dds = Array.isArray(c.drawdowns) ? c.drawdowns : [];
  dds.forEach((d, i) => {
    add(`Drawdown ${i + 1} - month ${d && d.month != null ? d.month : '-'}`, gbp(d && d.net));
  });
  add('Total Net incl. Drawdowns', gbp(c.total_net_incl_drawdowns), { bold: true, net: true });
  if (itype === 'Serviced' && c.monthly_payment) {
    add(`Monthly Payment${wp(c.retained_interest_day1_rate_pct)}`, gbp(c.monthly_payment), { bold: true });
  }
  return rows;
}

/**
 * Indicative terms table PDF.
 * @param {object} calc    output of computeIndicative().calc
 * @param {object} enquiry enquiry row (for applicant/property/ref context)
 */
async function buildIndicativePdf(calc, enquiry = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  header(doc, 'Indicative Loan Terms');

  // Client 29-09-2026: Date sits left of the Applicant name on one line, and the
  // Security Address uses the same font as that line.
  const META = { width: doc.page.width - 110 };
  doc.font('Helvetica').fontSize(10).fillColor(NAVY)
    .text(`Ref: ${enquiry.enquiry_ref || '-'}    Date: ${fmtDate(new Date())}    Applicant: ${enquiry.applicant_name || enquiry.company_name || '-'}`, 55, doc.y, META);
  doc.moveDown(0.3);
  // Client 09-10-2026: a multi-security deal lists each security on its own numbered line
  // (the single comma-run was impossible to read); one security still prints inline.
  const _secList = securityAddressList(enquiry, calc);
  if (_secList.length <= 1) {
    doc.text(`Security Address: ${_secList[0] || '-'}`, 55, doc.y, META);
  } else {
    doc.text('Security Address:', 55, doc.y, META);
    _secList.forEach((s, i) => doc.text(`   ${i + 1}. ${s}`, 55, doc.y, META));
  }
  doc.moveDown(1);
  doc.fillColor('#000000');

  for (const r of indicativeRows(calc)) {
    row(doc, r.label, r.value, {
      bold: !!r.bold,
      size: r.net ? 12 : 10,
      color: r.net ? '#b00020' : '#000000',
      rule: !!r.rule,
    });
  }

  // Footnote removed completely (client 30-09-2026): no "illustration only" / "subject to survey" lines.

  return toBuffer(doc);
}

/**
 * Official offer letter PDF (ScotLend template).
 *
 * Layout matches the client's Word template (Lery Resources Ltd Offer.pdf):
 *   - page 1 only : letterhead image (angled top strip, navy block with the real
 *                   ScotLend Group logo + address, gold rule) - cropped at 300dpi
 *                   from the client's own PDF, so it is pixel-identical.
 *   - pages 2..n  : angled gold / grey / navy footer strip, no header.
 *   - body        : Calibri-metric font (Carlito, OFL) 11pt, colour #1F497D,
 *                   31pt side margins, justified paragraphs, one blank line
 *                   between paragraphs, value column at 211pt.
 * Assets live in api/assets/offer/. If any are missing the letter still
 * renders (Helvetica + drawn bands) instead of failing.
 * @param {object} o  offer_json (all letter fields)
 */
async function buildOfferPdf(o = {}, enquiry = {}) {
  const fs = require('fs');
  const path = require('path');
  const { classifyApplicantType } = require('../../utils/applicant-type');
  const ASSETS = path.join(__dirname, '..', '..', 'assets', 'offer');
  const asset = (f) => { const p = path.join(ASSETS, f); return fs.existsSync(p) ? p : null; };

  const TXT = '#1F497D';        // body + headings (sampled from client PDF)
  const GOLDC = '#CCAA6D';
  const NAVYC = '#0A1D3C';
  // Letterhead with the ScotLend Group logo centred (client request); the original
  // left-logo letterhead stays as a fallback.
  // Client 13-10-2026: logo on the LEFT (left-aligned letterhead), not centred.
  const HEADER_IMG = asset('offer-header.png') || asset('offer-header-centred.png');
  const FOOTER_IMG = asset('offer-footer.png');
  const HEADER_H = 124;         // pt, height of the page-1 letterhead image
  const FOOTER_H = 28.3;        // pt, height of the footer strip image

  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: 42, bottom: 55, left: 31, right: 31 },
  });
  const PW = doc.page.width;
  const PH = doc.page.height;
  const L = 31;
  const W = PW - 62;
  const VAL_X = 211;            // value column (breakdown, charge address)
  const LBL_X = 103;            // NAME / ADDRESS / DATE / Re: value column

  // ---- fonts: Calibri metrics via Carlito; fall back to Helvetica ----
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

  // ---- letterhead (page 1) and footer strip (pages 2+) ----
  const drawHeader = () => {
    if (HEADER_IMG) { doc.image(HEADER_IMG, 0, 0, { width: PW, height: HEADER_H }); return; }
    doc.save();
    doc.rect(0, 0, PW, 11).fill('#132A4F');
    doc.polygon([0, 0], [115, 0], [100, 11], [0, 11]).fill(GOLDC);
    doc.rect(37, 40, PW - 74, 67).fill(NAVYC);
    doc.font('Helvetica-Bold').fontSize(26).fillColor(GOLDC).text('ScotLend', 47, 55);
    doc.moveTo(37, 119).lineTo(PW - 37, 119).lineWidth(1.5).strokeColor(GOLDC).stroke();
    doc.restore();
  };
  const drawFooter = () => {
    const y = PH - FOOTER_H;
    if (FOOTER_IMG) { doc.image(FOOTER_IMG, 0, y, { width: PW, height: FOOTER_H }); return; }
    doc.save();
    doc.rect(0, y + 11, PW, FOOTER_H - 11).fill(GOLDC);
    doc.polygon([PW, y], [PW - 195, y], [PW - 222, y + FOOTER_H], [PW, y + FOOTER_H]).fill('#132A4F');
    doc.restore();
  };

  drawHeader();
  doc.on('pageAdded', () => { drawFooter(); doc.y = doc.page.margins.top; });
  doc.y = 146;

  // ---- text helpers ----
  const font = (bold) => doc.font(bold ? BOLD : REG).fontSize(SIZE).fillColor(TXT);
  /** Paragraph: justified, followed by one blank line (Word "space after"). */
  const P = (t, opt = {}) => {
    font(opt.bold);
    doc.text(t, L, doc.y, { width: W, align: opt.align || 'justify' });
    doc.moveDown(opt.gap != null ? opt.gap : 1);
  };
  const H = (t) => P(t, { bold: true, align: 'left' });
  /** Label in the left column, value at x (single line spacing). */
  const KV = (label, value, x, opt = {}) => {
    // Break BEFORE drawing when the row won't fit: otherwise pdfkit adds a page for the
    // label, then the value (drawn at the old y) overflows onto yet another page.
    font(opt.bold);
    const need = Math.max(doc.currentLineHeight(true), doc.heightOfString(String(value), { width: L + W - x }));
    if (doc.y + need > PH - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    font(opt.boldLabel != null ? opt.boldLabel : opt.bold);
    doc.text(label, L, y, { width: x - L - 6, lineBreak: false });
    font(opt.bold);
    doc.text(value, x, y, { width: L + W - x });
    doc.moveDown(opt.gap != null ? opt.gap : 0);
  };
  /** Lettered list item with a hanging indent (letter at 31, text at 47). */
  const LI = (t) => {
    const m = t.match(/^([A-Z])\.\s+(.*)$/);
    font(false);
    const y = doc.y;
    if (m) {
      doc.text(`${m[1]}.`, L, y, { width: 16, lineBreak: false });
      doc.text(m[2], L + 16.3, y, { width: W - 16.3, align: 'left' });
    } else {
      doc.text(t, L, y, { width: W });
    }
  };
  const endList = () => doc.moveDown(1);
  const guardBreak = (need) => { if (doc.y > PH - doc.page.margins.bottom - need) doc.addPage(); };

  // ---- securities: one or many, each with its own charge (client 06-10-2026) ----
  // Client 07-10-2026: when no charge is selected (blank), show NO charge label at all —
  // not "1st" and not "2nd". Only an explicit 1st / 2nd produces a heading.
  const chgLabel = (ct) => {
    const s = String(ct == null ? '' : ct).trim().toLowerCase();
    if (s === '2nd' || s.startsWith('2nd')) return '2nd legal charge';
    if (s === '1st' || s.startsWith('1st')) return '1st legal charge';
    return '';
  };
  const secAddr = (x) => [x.address, x.security_type ? `(${x.security_type})` : ''].filter(Boolean).join(' ') || '-';
  // Unified list (main + additionals, equal footing). Falls back to the legacy
  // main + additional_securities shape for offers saved before this change.
  const UNI = Array.isArray(o.securities) ? o.securities.filter((x) => x && (x.address || x.value != null)) : [];
  let EXTRA, MAIN_VALUE, mainCharge, mainAddr;
  if (UNI.length) {
    mainAddr = UNI[0].address || o.security_address || '-';
    mainCharge = chgLabel(UNI[0].charge_type);
    MAIN_VALUE = UNI[0].value != null ? Number(UNI[0].value) : (o.main_property_value != null ? o.main_property_value : null);
    EXTRA = UNI.slice(1).map((x) => ({ address: x.address, value: x.value, _charge: chgLabel(x.charge_type) }));
  } else {
    EXTRA = Array.isArray(o.additional_securities) ? o.additional_securities.filter((x) => x && (x.address || x.value || x.security_type)) : [];
    MAIN_VALUE = o.main_property_value != null ? o.main_property_value : null;
    mainCharge = chgLabel(o.security_charge_type);
    mainAddr = o.security_address || '-';
  }
  const MULTI = EXTRA.length > 0;
  // _charge is set (possibly blank '') from the security's own charge_type on the
  // unified path; only the legacy path with no _charge infers 2nd from an existing charge.
  const chargeOf = (x) => (x._charge !== undefined ? x._charge : (Number(x.existing_charge) > 0 ? '2nd legal charge' : '1st legal charge'));
  const PROP = MULTI ? 'properties' : 'property';
  // Client 07-10-2026: securities are grouped BY CHARGE TYPE, in order of first
  // appearance. Securities that share a charge are joined on one line ("A & B"); when
  // charges differ, each charge gets its own line — a 2nd-charge property cannot sit
  // under a 1st-charge heading. One combined assumed value covers all of them, and no
  // per-property value rows are printed.
  const SECS = [{ charge: mainCharge, addr: mainAddr }, ...EXTRA.map((x) => ({ charge: chargeOf(x), addr: secAddr(x) }))];
  const CHG_GROUPS = [];
  for (const s of SECS) {
    let g = CHG_GROUPS.find((gg) => gg.charge === s.charge);
    if (!g) { g = { charge: s.charge, addrs: [] }; CHG_GROUPS.push(g); }
    g.addrs.push(s.addr);
  }

  const itype = o.interest_type || 'Serviced';
  const ratePct = o.monthly_rate_pct != null ? o.monthly_rate_pct : 1.05;

  // ---- addressee block ----
  KV('NAME:', o.borrower_name || '-', LBL_X, { bold: true, gap: 1.35 });
  KV('ADDRESS:', o.borrower_address || '-', LBL_X, { bold: true, gap: 1.35 });
  KV('DATE:', fmtDate(o.offer_date) || fmtDate(new Date()), LBL_X, { bold: true, gap: 1.9 });

  font(false);
  doc.text('Dear ', L, doc.y, { continued: true });
  font(true);
  // Client 06-10-2026: individual -> "Dear <applicant name>"; company -> "Dear
  // Directors of <company name>". Decided by the enquiry's APPLICANT TYPE, not by whether
  // a company name is present, so switching Company -> Individual (which may leave an old
  // company_name behind) no longer keeps printing "Directors of ...".
  const _cls = classifyApplicantType(enquiry && enquiry.applicant_type_name);
  const isCompany = !!enquiry && _cls.isCompany;
  const salCompany = enquiry && enquiry.company_name ? String(enquiry.company_name).trim() : '';
  const salIndiv = (enquiry && enquiry.applicant_name ? String(enquiry.applicant_name).trim() : '') || (o.borrower_name || '');
  const salutation = (isCompany && salCompany) ? ('Directors of ' + salCompany) : (salIndiv || 'Sir/Madam');
  doc.text(`${salutation},`);
  doc.moveDown(1.6);

  {
    const y = doc.y;
    font(true);
    doc.text('Re:', L, y, { lineBreak: false });
    // One line per charge group; each address on its own line (client 15-10-2026). "Re:" sits
    // on the first group's line; further charge groups line up under it.
    CHG_GROUPS.forEach((g, i) => {
      let gy = y;
      if (i > 0) { doc.moveDown(0.3); gy = doc.y; }
      if (g.charge) {
        doc.text(`${g.charge} over:`, LBL_X, gy, { lineBreak: false });
        doc.text(g.addrs.join('\n'), VAL_X, gy, { width: L + W - VAL_X });
      } else {
        // No charge selected: show the address only, no "legal charge over:" heading.
        doc.text(g.addrs.join('\n'), LBL_X, gy, { width: L + W - LBL_X });
      }
    });
    if (!MULTI) {
      doc.text(`Assumed asset value £${money(o.assumed_asset_value)}`, LBL_X, doc.y, { width: L + W - LBL_X });
    } else {
      // Combined (client 07-10-2026): one combined value on its OWN line at the left
      // margin below the joined addresses, matching the client's sample letter.
      doc.moveDown(0.6);
      doc.text(`Assumed asset value £${money(o.assumed_asset_value)} (combined)`, L, doc.y, { width: W });
    }
    doc.moveDown(1);
  }

  P('ScotLend Group Limited specialise in private secured short-term lending.');
  P('We are pleased to advise that further to our recent discussions your application for short term finance (the “Loan”) has been approved subject to the conditions contained herein.');
  P('The Loan has been approved but is conditional upon satisfactory searches and enquiries. The lender reserves the right to amend or withdraw this loan offer, should any such enquiries prove to be unsatisfactory to the lender (in its sole discretion).');

  H('Borrower (the “Borrower”)');
  P(o.borrower_name || '-', { bold: true, align: 'left' });

  H('The Purpose of Loan');
  P('The Loan is being provided solely or predominantly for business purposes, and the Borrower hereby confirms that the Loan is for business purposes as required by the Consumer Credit Act 1974.');

  // Keep the heading + breakdown table + net release together on one page.
  font(false);
  guardBreak(doc.currentLineHeight(true) * 13);
  H('Loan Amount');
  P('Breakdown of Loan Amount:', { align: 'left' });
  KV('Gross loan amount:', `£${money(o.gross_loan_amount)}`, VAL_X);
  KV('Legal fees (Incl. VAT):', o.legal_fees_text || 'TBC (Chaps fee £40)', VAL_X);
  // Client 07-10-2026: the "(of which £X is payable to <broker company>)" note sits on
  // the ARRANGEMENT FEE line; X is the broker-fee share (broker_fee_amount, from the
  // broker fee % on the Send Offer popup) and the payee is the broker's COMPANY name.
  // The broker fee is its own plain deduction line. Older offers stored the payable
  // part as finspace_fee.
  {
    const payable = o.broker_fee_amount != null ? Number(o.broker_fee_amount)
      : (o.finspace_fee != null ? Number(o.finspace_fee) : null);
    const payee = o.broker_payee_name != null ? String(o.broker_payee_name).trim() : '';
    // Client 09-10-2026: only show the "payable to <broker>" note when a broker is
    // actually selected (payee present). No broker -> just the arrangement fee amount.
    const part = payable && Number.isFinite(payable) && payable > 0 && payee
      ? ` (of which £${money(payable)} is payable to ${payee})` : '';
    KV('Less arrangement fee:', `£${money(o.arrangement_fee)}${part}`, VAL_X);
  }
  {
    const base = o.broker_fee_base != null ? Number(o.broker_fee_base)
      : (o.broker_fee != null ? Number(o.broker_fee) : null);
    if (base && Number.isFinite(base) && base > 0) {
      KV('Less broker fee:', `£${money(base)}`, VAL_X);
    }
  }
  KV('Less document fee:', `£${money(o.document_fee)}`, VAL_X);
  if (itype === 'Retained') {
    KV('Retained interest:', `£${money(o.retained_interest)} (${ratePct}%)`, VAL_X);
  } else {
    KV('Serviced interest:', `£${money(o.serviced_interest)}* ${o.serviced_interest_note || '(' + ratePct + '% pcm)'}`, VAL_X);
  }
  doc.moveDown(1);
  KV('Net release to borrower day 1:', `£${money(o.net_release_day1)}`, VAL_X, { bold: true, gap: 1 });

  // Drawdowns are quoted NET (what the borrower receives), matching the net release line above.
  const ddAmt = (d) => Number(d && (d.net != null ? d.net : d.amount)) || 0;
  const dds = Array.isArray(o.drawdowns) ? o.drawdowns.filter((d) => ddAmt(d) > 0) : [];
  if (dds.length) {
    const parts = dds.map((d) => `£${money(ddAmt(d))}${d.month ? ' (month ' + d.month + ')' : ''}`);
    P(`Followed by ${dds.length} x drawdown${dds.length > 1 ? 's' : ''} in arrears of ${parts.join(', ')}`, { bold: true, align: 'left' });
    if (o.net_release_incl_drawdowns != null) P(`Total net release including drawdowns: £${money(o.net_release_incl_drawdowns)}`, { bold: true, align: 'left' });
  }
  if (itype === 'Serviced') P(`*payable monthly at £${money(o.monthly_payment)}`, { bold: true, align: 'left' });

  P('Please note that the interest and the facility fee are capitalised and payable upon settlement/advancing the Loan amount (“settlement of the Loan”). If monthly interest is applicable, it is payable the month after retained interest ends.');
  P('The Borrower authorises ScotLend Group Limited to deduct (and/or to instruct the solicitors involved with the transaction, to deduct) any Establishment Fees, legal fees and outlays, interest, and any other amounts payable by the Borrower, from the Loan amount at settlement.');

  guardBreak(90);
  H('Interest Rate Applied');
  // Client 09-10-2026: the Nominal (default) rate follows the enquiry's jurisdiction —
  // Scotland 4%, England/Wales 3% — so every offer PDF (emailed, Initial Offer download,
  // underwriting sanction letter) matches the chosen applicant-type template, even for an
  // offer_json saved before this rule. Falls back to the stored value when no type is known.
  const nominalDefault = (enquiry && enquiry.applicant_type_name)
    ? (_cls.region === 'SCOTLAND' ? 4 : 3)
    : (o.default_rate_pct != null ? o.default_rate_pct : 4);
  P(`The discounted rate of interest payable on the Loan amount will be ${ratePct} % per month. This rate of interest assumes strict compliance with the terms of the Loan documentation. In the event of a default under the terms of the Loan documentation, you will be liable for our Nominal rate of interest of ${nominalDefault}%.`);

  guardBreak(60);
  H('Term of Loan');
  P(`The Loan shall be for a term of ${o.term_months || 12} months from the date of the advance of the Loan.`);

  guardBreak(80);
  H('Early Loan Repayments');
  P(`The minimum term of the loan is for ${o.min_term_months || 3} months. That is, if the Borrower would like to repay the amount of the Loan prior to the end of the term, then interest will be payable for this minimum term. There is an exit charge applicable to this loan equivalent to 1 months interest.`);

  guardBreak(120);
  H('Security and Loan Documentation');
  P('The Lender anticipates taking security for the Loan, which will include the following (the “Security”):');
  // Client 07-10-2026: securities grouped by charge, each differing charge on its own
  // line. No per-property value rows.
  // Client 15-10-2026: within a charge group every address now sits on its OWN line
  // (previously joined "A & B" on one run-on line).
  CHG_GROUPS.forEach((g) => {
    if (g.charge) KV(`${g.charge} over:`, g.addrs.join('\n'), VAL_X, { bold: true, gap: 1 });
    else P(g.addrs.join('\n'), { bold: true, align: 'left' }); // no charge selected: address only
  });
  if (MULTI) P(`The Loan is secured across all ${SECS.length} properties listed above, with a total assumed value of £${money(o.assumed_asset_value)} (combined).`);
  // Client 09-10-2026: the company security line prints only for a company borrower,
  // and the wording differs by jurisdiction (England/Wales debenture vs Scotland bond
  // & floating charge). Individual offer letters carry no such line.
  if (isCompany) {
    P(_cls.region === 'SCOTLAND'
      ? 'Personal Guarantee, Bond and Floating Charge required.'
      : 'Personal guarantee and company debenture required.');
  }
  P('Each mortgage and charge shall be in registrable form and registered with the relevant government department if required by the Lender.');

  guardBreak(60);
  H('Not Principal Residence');
  P(o.not_principal_residence || 'N/A');

  guardBreak(200);
  H('Documents to be Provided by Borrower');
  P('The Lender may require the following, prior to Settlement of the Loan:');
  [
    'A. Valuation, addressed to ScotLend Group Limited from our panel',
    'B. The property must be on the market for sale within 4 weeks of drawdown of the loan;',
    'C. Evidence of the limit, and total outstanding in relation to any priority securities;',
    'D. A detailed explanation of the business purposes for the loan;',
    'E. Copy of signed acceptance of this letter;',
    'F. If the Borrower or Guarantor is acting in the capacity of a trustee for a trust, then the Lender will require the original stamped Trust Deed (and any variation thereof);',
    'G. Any such other documentation that the Lender may request',
    'H. Up to date Equifax Report',
    'I. Any outstanding secured arrears must be cleared before drawdown of our loan',
    'J. Should the property be a below market value purchase (BMV) you will be required to take out Title Indemnity Insurance to complete the loan',
  ].forEach(LI);
  endList();

  guardBreak(110);
  H('How the Loan Works');
  P('This document sets out the proposed terms of the loan but does not include all of the terms and conditions. Before completion you will need to sign a legal mortgage, which will be sent to your solicitors so they may advise on that document. The mortgage deed will set out the commercial terms of the loan and will also set out the full terms and conditions.');

  guardBreak(130);
  H('Valuation Fees and Legal Fees');
  P(`The fees for the valuation${MULTI ? 's' : ''} for the above security ${PROP} and the legal fees incurred by the Lender in relation to this application are payable by the borrower.`);
  P(`The Lender’s legal fees stated above are based on your solicitor providing a complete and full pack of the title documentation and supporting information. In the event a full pack of information is not supplied in one bundle, and or it becomes necessary for the Lender’s solicitor to chase outstanding information and or in the event that additional unforeseen legal work is required additional fees will be incurred. You will be notified of any such change in advance.`);

  guardBreak(200);
  H('Withdrawal of Loan Offer');
  P('This letter of offer may be withdrawn or revoked by the Lender at any time prior to the Loan amount being advanced:');
  [
    'A. If the Lender becomes aware that the Loan is being processed or looked at by an alternative lender within the marketplace;',
    'B. If the results of any searches or enquiries in relation to the Security are not entirely satisfactory to the Lender;',
    'C. If the Borrower fails to execute the Loan documentation as required by the Lender, on terms and conditions satisfactory to the Lender, within three (3) business days of receiving such documentation;',
    'D. If circumstances arise which mean that the Lender is unable to provide the Loan, or circumstances arise where (in the Lender’s sole opinion) it may be prejudicial or disadvantageous to the Lender’s interest to provide the Loan;',
    'E. If the Lender receives advice from its advisors that it should not proceed with the Loan (such advice may be confidential and not disclosed to the Borrower, in such circumstances).',
  ].forEach(LI);
  endList();
  P('The Lender is not under any obligation to notify you that the Loan offer contained in this letter has been revoked.');

  guardBreak(80);
  H('Obtain own Advice');
  P('You acknowledge and agree ScotLend Group Limited does not, and will not, provide any financial, accounting, taxation, or legal advice in relation to the Loan. This includes any advice as to the suitability of the Loan for the Borrower.');

  guardBreak(80);
  H('Agency and Conflict of Interest');
  P('You acknowledge that ScotLend Group Limited does not act as your/the Borrower’s agent in relation to a particular transaction. Furthermore, you waive any claim to a conflict of interest in relation to any transaction that you may be involved with through ScotLend Group Limited.');

  guardBreak(70);
  H('Data Protection');
  P('By entering into this agreement, you agree and consent to ScotLend Group Limited sharing information about your application to third party investors and loan funders with which it works.');

  guardBreak(60);
  H('Validity');
  P(`This offer in principle is valid for a period of ${o.validity_days || 7} days from the date of issuance.`);

  guardBreak(90);
  H('Indemnity');
  P('You agree to indemnify and hold ScotLend Group Limited harmless (including all of its employees, agents and directors) against any claims, losses, damages, liabilities, costs and expenses incurred arising out of or related to any actual or threatened claim against (or any of its employees, agents and directors) which involves you (except for instances where such liability arises through direct gross negligence or fraud).');

  guardBreak(330);
  H('Acceptance');
  P('This offer may be accepted only by the Borrower by signing a copy of this letter (including signing each page at the bottom right-hand side).');
  P('This offer of Loan is not binding on the Lender until such time as all of the final Loan documentation has been executed by the Lender.');
  P('If you have any questions in relation to the matters detailed in this letter, please do not hesitate to contact me.');
  P('Yours sincerely,', { gap: 2 });
  P('David Travers', { bold: true, align: 'left', gap: 0 });
  P('Director', { align: 'left', gap: 0 });
  P('ScotLend Group Limited', { align: 'left', gap: 1 });
  P('To proceed with this loan offer please sign below-', { align: 'left', gap: 2.5 });

  // signature block — two columns of Print / Sign / Date
  // Two equal columns; dots sized to fill each column exactly so they never wrap.
  const GUTTER = 30;
  const colW = (W - GUTTER) / 2;
  const colX2 = L + colW + GUTTER;
  font(false);
  const dotLine = (label) => label + '…'.repeat(Math.max(0, Math.floor((colW - doc.widthOfString(label) - 2) / doc.widthOfString('…'))));
  ['Print', 'Sign', 'Date'].forEach((label) => {
    const y = doc.y;
    font(false);
    doc.text(dotLine(label), L, y, { width: colW, lineBreak: false });
    doc.text(dotLine(label), colX2, y, { width: colW, lineBreak: false });
    doc.y = y;
    doc.moveDown(2.5);
  });

  return toBuffer(doc);
}

/**
 * Application form PDF, pre-filled from the enquiry (blanks where data is absent).
 * Mirrors the ScotLend "Application for Bridging Loan" section layout.
 */
/**
 * Application form PDF.
 * @param {object} e     enquiry row
 * @param {object} calc  indicative calc (unused for most sections)
 * @param {object} extra `{ solicitor: { firm_name, contact_name, address, telephone,
 *                          email, sra_partners, sra_no } }` — section 5 is filled from
 *                       underwriting step 4 (Solicitor Quote) when the form is sent
 *                       with the requirements pack; blank when there is no case yet.
 *                       `offer` = the offer_json actually sent / accepted - section 2
 *                       loan figures come from it, not the original enquiry amount.
 */
async function buildApplicationFormPdf(e = {}, calc = {}, extra = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const LEFT = 40;
  const RIGHT = doc.page.width - 40;
  const W = RIGHT - LEFT;
  const BOTTOM = doc.page.height - 50;

  const ensure = (h) => { if (doc.y + h > BOTTOM) doc.addPage(); };
  // Client 15-10-2026: same letterhead as the Loan Offer PDF (logo LEFT, address RIGHT);
  // the centred banner below is only the fallback when the letterhead image is missing.
  const OFFER_HEADER = (() => {
    const p = require('path').join(__dirname, '..', '..', 'assets', 'offer', 'offer-header.png');
    return require('fs').existsSync(p) ? p : null;
  })();
  const brandHeader = () => {
    if (OFFER_HEADER) {
      const HH = 124; // same height as the offer letter's page-1 letterhead
      doc.image(OFFER_HEADER, 0, 0, { width: doc.page.width, height: HH });
      doc.y = HH + 8; doc.fillColor('#000000');
      return;
    }
    const BAND_H = 56;
    doc.rect(0, 0, doc.page.width, BAND_H).fill(LOGO_NAVY);
    if (LOGO_PATH) {
      const LH = 42; const LW = LH * LOGO_RATIO;
      doc.image(LOGO_PATH, (doc.page.width - LW) / 2, (BAND_H - LH) / 2, { width: LW, height: LH });
    } else {
      doc.fillColor(GOLD).fontSize(18).font('Helvetica-Bold').text('ScotLend Group', 0, 18, { width: doc.page.width, align: 'center' });
    }
    doc.y = 68; doc.fillColor('#000000');
  };
  brandHeader();
  doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold').text('APPLICATION FOR BRIDGING LOAN', LEFT, doc.y, { width: W, align: 'center' });
  doc.moveDown(0.4);
  // Client 20-10-2026: instruction moved from the bottom of the form to the top, under the title.
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#333333')
    .text('Please complete any blank fields and return signed. If any of the pre-filled information is wrong, please cross it out and provide the correct information. Any questions feel free to get in contact.', LEFT, doc.y, { width: W, align: 'center' });
  doc.moveDown(0.8); doc.fillColor('#000000');

  const section = (title) => {
    ensure(30);
    const y = doc.y;
    doc.rect(LEFT, y, W, 18).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(title, LEFT + 6, y + 4);
    doc.y = y + 22; doc.fillColor('#000000');
  };
  const sub = (title) => {
    ensure(20);
    const y = doc.y;
    doc.rect(LEFT, y, W, 15).fill('#c9d6ea');
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text(title, LEFT + 6, y + 3);
    doc.y = y + 18; doc.fillColor('#000000');
  };
  // A blank field prints BLANK, not a dash. This is a form the applicant fills
  // in by hand after receiving it - a printed "—" reads as "not applicable" and
  // leaves them nowhere to write. Used by the offer email AND by the
  // underwriting Requirements-to-Broker email, which builds the same PDF.
  const field = (label, value) => {
    ensure(20);
    const y = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text(label, LEFT + 4, y, { width: 200 });
    doc.font('Helvetica-Bold').fillColor('#000000').text(value != null && value !== '' ? String(value) : '', LEFT + 210, y, { width: W - 214 });
    const yy = Math.max(doc.y, y + 12);
    doc.moveTo(LEFT + 4, yy).lineTo(RIGHT, yy).strokeColor('#eeeeee').lineWidth(0.5).stroke();
    doc.y = yy + 3;
  };
  const note = (t) => { ensure(16); doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY).text(t, LEFT + 4, doc.y, { width: W }); doc.moveDown(0.3); doc.fillColor('#000000'); };
  const gbp = (v) => (v == null || v === '' ? '' : '£' + money(v));
  const yn = (v) => (v == null || v === '' ? '' : (v === true || v === 1 || v === '1' || v === 'true' ? 'Yes' : 'No'));
  const dOnly = fmtDate; // every date in this PDF uses the one house format
  // Debt secured on a property: outstanding loan, plus the existing charge amount when we
  // take a 2nd charge (the enquiry captures that as charge_amount). Client 14-10-2026: the
  // lender filled in but the outstanding loan stayed blank when only the charge was typed.
  const debtOf = (x = {}) => {
    const n = (v) => { const k = Number(v); return Number.isFinite(k) && k > 0 ? k : 0; };
    const is2nd = String(x.charge_type || '').trim().toLowerCase().startsWith('2nd');
    const d = n(x.outstanding_loan) + (is2nd ? n(x.charge_amount) : 0);
    return d > 0 ? d : null;
  };

  // Client 15-10-2026: section 1 is the BROKER (introducer) from the Broker master - not the
  // applicant. No broker on the enquiry -> the rows stay blank for the broker to fill in.
  // Broker Fee = what was entered on the indicative (% or £).
  section('1. Introducer Details');
  const br = e.broker || {};
  field('Introducer Name', br.name || e.broker_name_text || e.broker_name);
  field('Company Name', br.company || e.broker_company);
  field('Contact Number', br.phone);
  field('Email', br.email || e.broker_email);
  field('Address', br.address);
  field('FCA Number', br.fca_number);
  // Client 20-10-2026: Broker Fee is left BLANK for the broker to fill in themselves
  // (no % in the label, no amount pre-filled).
  field('Broker Fee (£ or %)', '');

  section('2. Loan Details');
  // Client 14-10-2026: the loan figures are what we OFFERED (offer letter), not the amount
  // first asked for on the enquiry. Order of preference: offer -> latest indicative calc
  // -> enquiry amount (blank form / no terms issued yet).
  const offer = (extra && extra.offer) || null;
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  let grossAmt = null; let netAmt = null; let termM = e.term_months;
  if (offer) {
    grossAmt = num(offer.gross_loan_amount);
    // Client 20-10-2026: a loan with drawdowns shows the TOTAL net incl. the drawdowns, the
    // same way the gross already includes them; no drawdowns -> the Day 1 net as before.
    const ddNet = num(offer.drawdowns_net_total);
    netAmt = ddNet && ddNet > 0 && num(offer.net_release_incl_drawdowns) != null
      ? num(offer.net_release_incl_drawdowns) : num(offer.net_release_day1);
    if (offer.term_months != null && offer.term_months !== '') termM = offer.term_months;
  } else if (calc && (calc.total_gross_loan_incl_dds != null || calc.day1_net != null)) {
    grossAmt = num(calc.total_gross_loan_incl_dds != null ? calc.total_gross_loan_incl_dds : calc.base_gross);
    // Client 20-10-2026: with drawdowns the net is the TOTAL net incl. drawdowns (as the gross).
    netAmt = num(calc.total_net_incl_drawdowns != null && Number(calc.drawdowns_net_total) > 0 ? calc.total_net_incl_drawdowns : calc.day1_net);
    if (calc.term_months != null && calc.term_months !== '') termM = calc.term_months;
  } else if (e.loan_basis === 'Gross') {
    grossAmt = num(e.amount_requested);
  } else {
    netAmt = num(e.amount_requested);
  }
  field('Gross Loan Amount', gbp(grossAmt));
  field('Net Loan Amount Required', gbp(netAmt));
  field('Loan Term (months)', termM);
  // Client 20-10-2026: left blank for the applicant to fill in.
  field('Purpose of Funds', '');
  field('Total Project Cost', gbp(e.total_project_cost));
  field('Required Completion Date', fmtDate(e.requested_completion_date));
  field('Type of Loan', e.product_name);
  // Client 15-10-2026: captured on New Enquiry step 3.
  field('Exit Strategy', e.exit_strategy);
  field('Deposit Source', e.deposit_source);
  field('Own Contribution', gbp(e.own_contribution));
  field('Any Additional Borrowing?', e.additional_borrowing != null && e.additional_borrowing !== '' ? yn(e.additional_borrowing) : '');

  section('3. Security Details');
  field('Property Address', e.property_address);
  field('Postcode', e.postcode);
  field('Property Type', e.property_type);
  field('Tenure', e.tenure ? (e.tenure + (e.tenure === 'Leasehold' && e.tenure_years != null ? ' (' + e.tenure_years + ' yrs)' : '')) : '');
  field('Charge (1st / 2nd)', e.charge_type);
  field('Property Value', gbp(e.estimated_value));
  field('Estimated Value on Completion (GDV)', gbp(e.gdv != null ? e.gdv : (calc && calc.gdv)));
  // Client 15-10-2026: no LTV row on any security (main or additional).
  // Client 20-10-2026: "Do you own…" / "To be repaid on completion?" left blank for the applicant.
  field('Do you own this property?', '');
  field('Purchase Price', gbp(e.purchase_price));
  field('Date of Purchase / Completion', dOnly(e.purchase_date));
  field('Outstanding Loan Amount', gbp(debtOf(e)));
  field('To be repaid on completion?', '');
  field('Lender', e.lender);
  field('Added Value Since Purchase', e.added_value);

  // Client 06-10-2026: list EVERY additional security with the same field set as the
  // main property - all securities are of equal importance on the facility.
  {
    const addSecs = Array.isArray(e.additional_securities) ? e.additional_securities : [];
    addSecs.forEach((x, i) => {
      if (!x || typeof x !== 'object') return;
      sub('ADDITIONAL SECURITY ' + (i + 1));
      field('Property Address', x.address);
      field('Postcode', x.postcode);
      field('Property Type', x.property_type);
      field('Tenure', x.tenure ? (x.tenure + (x.tenure === 'Leasehold' && x.tenure_years != null && x.tenure_years !== '' ? ' (' + x.tenure_years + ' yrs)' : '')) : '');
      field('Charge (1st / 2nd)', x.charge_type);
      field('Property Value', gbp(x.estimated_value));
      field('Estimated Value on Completion (GDV)', gbp(x.gdv));
      field('Do you own this property?', '');
      field('Purchase Price', gbp(x.purchase_price));
      field('Date of Purchase / Completion', dOnly(x.purchase_date));
      field('Outstanding Loan Amount', gbp(debtOf(x)));
      field('To be repaid on completion?', '');
      field('Lender', x.lender);
      field('Added Value Since Purchase', x.added_value);
    });
  }

  section('4. Applicant(s) / Director(s) Details');
  const applicants = Array.isArray(e.applicants) && e.applicants.length
    ? e.applicants
    : [{ full_name: e.applicant_name, dob: e.dob, email: e.email, mobile: e.phone, employer_name: e.company_name, is_primary: 1 }];
  applicants.forEach((a, i) => {
    sub('APPLICANT ' + (i + 1) + (a.is_primary ? ' (PRIMARY)' : ''));
    field('Full Name', a.full_name);
    field('Date of Birth', dOnly(a.dob));
    field('Nationality', a.nationality);
    field('Address', a.address);
    field('Time at Address', a.time_at_address);
    field('Email', a.email);
    field('Mobile', a.mobile);
    field('Do you own your home?', a.owns_home != null ? yn(a.owns_home) : '');
    field('Occupation', a.occupation);
    field('Employer or Business Name', a.employer_name);
    field('Business Address', a.business_address);
    field('Length of Service', a.length_of_service);
    field('Relationship to Borrower Company', a.relationship);
    field('Shareholding %', a.shareholding_pct != null ? a.shareholding_pct + '%' : '');
    field('Previous Bridging Experience?', a.prev_bridging != null ? yn(a.prev_bridging) : '');
    field('If Yes, which lender?', a.prev_bridging_lender);
  });

  // Client 15-10-2026: the enquiry captures Single / Dual representation (step 3). Single
  // rep -> the borrower's own solicitor typed on the enquiry fills this section; any value
  // captured later in underwriting (extra.solicitor) still wins field by field.
  const repType = String(e.rep_type || '').toLowerCase();
  const enqSol = repType === 'single' ? {
    firm_name: e.borrower_sol_firm, contact_name: e.borrower_sol_contact, address: e.borrower_sol_address,
    telephone: e.borrower_sol_telephone, email: e.borrower_sol_email,
    sra_partners: e.borrower_solicitor ? e.borrower_solicitor.sra_partners : null,
  } : {};
  const stepSol = (extra && extra.solicitor) || {};
  const sol = { ...stepSol };
  for (const k of Object.keys(enqSol)) {
    if ((sol[k] == null || sol[k] === '') && enqSol[k] != null && enqSol[k] !== '') sol[k] = enqSol[k];
  }
  section('5. Solicitor Details');
  if (repType === 'single' || repType === 'dual') {
    field('Representation', repType === 'dual' ? 'Dual Representation' : 'Single Representation');
  }
  field('Firm Name', sol.firm_name || '');
  field('Contact Name', sol.contact_name || '');
  field('Address', sol.address || '');
  field('Telephone', sol.telephone || '');
  field('Email', sol.email || '');
  field('Number of SRA Partners', sol.sra_partners != null && sol.sra_partners !== '' ? String(sol.sra_partners) : '');
  // Captured in underwriting step 4; printed only when there is one, so the
  // blank form keeps the client's six rows exactly.
  if (sol.sra_no) field('SRA / Regulator No.', String(sol.sra_no));
  if (sol.lender_solicitor) field('Lender Solicitor', String(sol.lender_solicitor));
  if (sol.quote_amount) field('Solicitor Fee Quote', '£' + money(sol.quote_amount));
  if (sol.quote_date) field('Quote Date', fmtDate(sol.quote_date));

  section('6. Summary of Assets and Liabilities');
  note('Provide approximate values for each applicant.');
  sub('ASSETS');
  // Client 20-10-2026: Main Residence left blank for the applicant (the security is not
  // necessarily their main residence).
  field('Main Residence (Value / Mortgage / Address)', '');
  // Client 21-10-2026: Other Property rows are no longer auto-filled from the enquiry's
  // securities - always three blank rows for the applicant to fill in.
  field('Other Property 1 (Value / Mortgage / Address)', '');
  field('Other Property 2 (Value / Mortgage / Address)', '');
  field('Other Property 3 (Value / Mortgage / Address)', '');
  // Client 20-10-2026: the "If more properties are owned…" note was removed - section 8's
  // title already asks for additional property information.
  field('Savings / Bank Deposits', '');
  field('Investments (e.g. shares, ISAs)', '');
  field('Other Assets (cars, jewellery, etc.)', '');
  // Client 14-10-2026: left blank for the applicant - an auto-sum of the securities is
  // wrong as soon as they add savings / other property on the form.
  field('Total Assets', '');
  sub('LIABILITIES');
  field('Mortgages', '');
  field('Loans / HP / Credit', '');
  field('Personal Guarantees', '');
  field('Total Liabilities', '');

  section('7. Credit History (For All Borrowers)');
  field('Ever refused a mortgage or loan?', '');
  field('Any court judgments or defaults?', '');
  field('Ever bankrupt or entered an IVA?', '');
  field('Missed mortgage or loan payments?', '');
  field('Any criminal convictions (non-driving)?', '');
  field('Any other relevant credit issues?', '');
  field("If 'Yes' to any, please give details:", '');

  section('8. Notes — Place additional property information or extra details for borrowers here');
  ensure(120);
  const ny = doc.y;
  doc.rect(LEFT, ny, W, 110).strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.y = ny + 114;

  const DECL_TXT = 'Please note that it is a criminal offence to knowingly or recklessly give false, inaccurate or misleading information when applying for a loan. If you provide such information, you may be reported to the police and prosecuted. As a responsible lender, ScotLend Group Limited (\"SLG\" hereafter) will carefully assess the information you have provided in the Application Form in order to decide whether or not to make you an offer of a Loan. Even if we do issue an Offer Letter to you, we have the right at any time before any loan completes to withdraw, revise or cancel our offer without providing a reason. It is important you ensure that all statements you make in this Application Form and other documents in connection with this application are full and accurate and are correct and that you have read and understood the content of this declaration. All security property(ies) must be adequately insured, unless indicated to the contrary.';
  const D2_TXT = 'Credit Reference Agencies & Credit Searches (1) I/We understand and confirm that SLG may make a search or register information about me/us and the conduct of my/our account with a licenced credit reference agency in order to assist SLG in making credit decisions and occasionally for fraud prevention or for tracing debtors. Processing of Application (2) I/We authorise SLG to (a) make searches of the records at fraud prevention agencies who may provide SLG with information in order to prevent or detect fraud, the information provided in this application can be shared with fraud prevention agency/ies to prevent fraud and money laundering and to verify my/our identity; this will include a search for similar applications with other members and if fraud is suspected details will be shared with them which may be used in their decision making and could result in certain services, finance or employment being refused, (b) make such enquiries of any person or organisation (including my/our existing or previous mortgage lenders), as SLG considers necessary in connection with this application; and, (c) pass information to financial and other organisations involved in fraud prevention to protect SLG from fraud and theft. (d) Give out information about me/us if you have a duty to do so or if the law allows you to do so. (3) I/We understand that if I/we give SLG false or inaccurate information and SLG suspect fraud, then SLG will record this; and, (4) I/We authorise our solicitor or licensed conveyancer acting on my/our behalf to disclose to SLG or its solicitor and confirm that SLG is authorised to disclose to my/our solicitor or licensed conveyancer, any information relating to this application; and, (5) I/We confirm that I/we give up any right to claim solicitor/client confidentiality or legal privilege in respect of such information; and, (6) I/We acknowledge and understand that SLG takes its lending both responsibly and seriously and that as part of its Treating Customers Fairly policy, SLG prefers to be proactive and assist customers who need to repay their SLG Loan(s); and, (7) I/We appreciate that SLG needs to ensure that the mortgaged property(ies) that I/we have provided as security for my/our Loan must continue at all times to be insured and/or, (8) I/We acknowledge and understand that SLG needs to be able to contact some or all of the following in connection with any Loan that I/we may have with SLG namely: my/our solicitor, (where appropriate) the intermediary who introduced me/our loan with SLG and the insurance company(ies) that has/have insured the property(ies) that I/we have provided to SLG as security for my/our Loan. If we transfer your information to a service provider or agent in another country, we will make sure that the service provider or agent agrees to apply the same levels of protection as we are required to apply to information held in the UK and to use your information only for the purpose of providing the service to us. Accordingly, I/we irrevocably confirm that until our Loan has been repaid in full, SLG, its successors and assigns may contact and disclose to any of the above mentioned person(s) or organisation(s) and they may disclose to SLG such information as SLG may consider reasonably necessary and request from such person(s) or organisations in dealing with the repayment or refinance of my/our SLG Loan(s) and/or in connection with the insurance of the property(ies) which comprises SLG\'s security.';
  const D3_TXT = 'By signing this Application Form - either electronically or physically signing it - I/we confirm that the information provided is true, accurate and correct and I/we declare that the information relating to my/our income and outgoings is true and accurate and that I/We am/are financially able to meet all my/our financial commitments including any interest payments I/we will be required to make on my/our Loan. Under the Data Protection Act 1998, you are entitled to know what information is held about you on our computers and on certain other records and to ask for any inaccurate details to be amended. You may also ask which fraud prevention agencies we use and how they use your information. If you have any questions about the Data Protection Act, or your rights under it, please write to the Data Protection Officer at SLG ScotLend Group Limited, Calder House, 8 South Caldeen Road, Coatbridge ML5 4EG.';
  const WARN_TXT = 'WARNING: YOUR HOME MAY BE REPOSSESSED IF YOU DO NOT KEEP UP PAYMENTS ON YOUR MORTGAGE. ONLY SIGN THIS FORM ONCE YOU HAVE CHECKED THAT ALL INFORMATION IS ACCURATE, ESPECIALLY IF COMPLETED BY SOMEONE ELSE ON YOUR BEHALF';
  // Client 20-10-2026: the "Please complete any blank fields…" note now sits at the top, under the title.

  // ---- Declaration page (static legal text + signatures) ----
  doc.addPage();
  section('Declaration');
  const dpara = (t) => { ensure(26); doc.font('Helvetica').fontSize(8).fillColor('#000000').text(t, LEFT + 2, doc.y, { width: W, align: 'left' }); doc.moveDown(0.5); };
  const dsub = (t) => { ensure(16); doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(t, LEFT + 2, doc.y, { width: W }); doc.moveDown(0.25); doc.fillColor('#000000'); };
  const dcl = (t) => { ensure(22); doc.font('Helvetica').fontSize(8).fillColor('#000000').text(t, LEFT + 14, doc.y, { width: W - 16, align: 'left' }); doc.moveDown(0.35); };
  dpara(DECL_TXT);
  dsub('Credit Reference Agencies & Credit Searches');
  dcl('(1) I/We understand and confirm that SLG may make a search or register information about me/us and the conduct of my/our account with a licenced credit reference agency in order to assist SLG in making credit decisions and occasionally for fraud prevention or for tracing debtors.');
  dsub('Processing of Application');
  dcl('(2) I/We authorise SLG to (a) make searches of the records at fraud prevention agencies who may provide SLG with information in order to prevent or detect fraud, the information provided in this application can be shared with fraud prevention agency/ies to prevent fraud and money laundering and to verify my/our identity; this will include a search for similar applications with other members and if fraud is suspected details will be shared with them which may be used in their decision making and could result in certain services, finance or employment being refused, (b) make such enquiries of any person or organisation (including my/our existing or previous mortgage lenders), as SLG considers necessary in connection with this application; and, (c) pass information to financial and other organisations involved in fraud prevention to protect SLG from fraud and theft. (d) Give out information about me/us if you have a duty to do so or if the law allows you to do so.');
  dcl('(3) I/We understand that if I/we give SLG false or inaccurate information and SLG suspect fraud, then SLG will record this; and,');
  dcl('(4) I/We authorise our solicitor or licensed conveyancer acting on my/our behalf to disclose to SLG or its solicitor and confirm that SLG is authorised to disclose to my/our solicitor or licensed conveyancer, any information relating to this application; and,');
  dcl('(5) I/We confirm that I/we give up any right to claim solicitor/client confidentiality or legal privilege in respect of such information; and,');
  dcl('(6) I/We acknowledge and understand that SLG takes its lending both responsibly and seriously and that as part of its Treating Customers Fairly policy, SLG prefers to be proactive and assist customers who need to repay their SLG Loan(s); and,');
  dcl('(7) I/We appreciate that SLG needs to ensure that the mortgaged property(ies) that I/we have provided as security for my/our Loan must continue at all times to be insured and/or,');
  dcl('(8) I/We acknowledge and understand that SLG needs to be able to contact some or all of the following in connection with any Loan that I/we may have with SLG namely: my/our solicitor, (where appropriate) the intermediary who introduced me/our loan with SLG and the insurance company(ies) that has/have insured the property(ies) that I/we have provided to SLG as security for my/our Loan.');
  dpara('If we transfer your information to a service provider or agent in another country, we will make sure that the service provider or agent agrees to apply the same levels of protection as we are required to apply to information held in the UK and to use your information only for the purpose of providing the service to us.');
  dpara('Accordingly, I/we irrevocably confirm that until our Loan has been repaid in full, SLG, its successors and assigns may contact and disclose to any of the above mentioned person(s) or organisation(s) and they may disclose to SLG such information as SLG may consider reasonably necessary and request from such person(s) or organisations in dealing with the repayment or refinance of my/our SLG Loan(s) and/or in connection with the insurance of the property(ies) which comprises SLG\'s security.');
  dpara(D3_TXT);
  doc.moveDown(0.4);
  ensure(26);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#b00020').text(WARN_TXT, LEFT + 2, doc.y, { width: W });
  doc.moveDown(1.4); doc.fillColor('#000000');
  const sig = (label) => {
    ensure(30);
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#000000').text(label, LEFT + 2, y);
    doc.moveTo(LEFT + 170, y + 10).lineTo(LEFT + 360, y + 10).strokeColor('#000').lineWidth(0.7).stroke();
    doc.font('Helvetica').fontSize(9).text('Date:', LEFT + 380, y);
    doc.moveTo(LEFT + 415, y + 10).lineTo(RIGHT, y + 10).strokeColor('#000').lineWidth(0.7).stroke();
    doc.y = y + 30;
  };
  sig('Signature (Applicant 1):');
  sig('Signature (Applicant 2):');

  return toBuffer(doc);
}

module.exports = { buildIndicativePdf, buildOfferPdf, buildApplicationFormPdf, indicativeRows, securityAddress, securityAddresses, securityAddressList };