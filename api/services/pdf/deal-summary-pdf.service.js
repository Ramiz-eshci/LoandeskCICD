'use strict';

/**
 * Credit Deal Summary PDF (client 29-09-2026).
 *
 * Sent to "Head of Application" users when an enquiry is converted into an
 * application, so they can check the deal from their inbox before it goes to
 * underwriting. Modelled on the client's "Summary Campbell Thomson" document:
 * File Owner, borrower, security, value, current debt, deal type, property,
 * appraisal, exit, loan terms (gross / net / LTV / rate / interest / fees),
 * capital stack, narrative, Credit Committee box and introducer.
 * Everything is generated from the enquiry + the agreed terms (offer / indicative).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const NAVY = '#0A1D3C';
const GOLD = '#c79a4b';
const GREY = '#666666';
const LOGO = (() => {
  const p = path.join(__dirname, '..', '..', 'assets', 'offer', 'scotlend-logo.png');
  return fs.existsSync(p) ? p : null;
})();
const LOGO_RATIO = 840 / 266;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : 0; };
const gbp = (v) => {
  const n = num(v);
  return n === null ? '' : '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pc = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '' : `${Math.round(Number(v) * 100) / 100}%`);
const dmy = (v) => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};
const yn = (v) => (v == null || v === '' ? '' : (v === true || v === 1 || v === '1' || v === 'true' ? 'Yes' : 'No'));
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

/** Debt already secured on one property: outstanding loan + 2nd-charge amount. */
function debtOf(s) {
  if (!s) return 0;
  return pos(s.outstanding_loan) + (String(s.charge_type || '') === '2nd' ? pos(s.charge_amount) : 0)
    + (s.outstanding_loan == null ? pos(s.existing_charge) : 0);
}

/**
 * All the figures the summary prints, worked out once (also used by the email body).
 * @param {object} e      enquiry (getById shape)
 * @param {object} terms  { gross, term, ratePct, source, pack } from agreedTerms()
 */
function summaryFigures(e = {}, terms = {}) {
  const secs = Array.isArray(e.additional_securities) ? e.additional_securities : [];
  const pack0 = terms.pack || {};
  // Client 09-10-2026: property value was printing £0 whenever the enquiry row had no
  // estimated_value (the figure was only on the accepted indicative / offer). Fall back to
  // the agreed-terms pack's property value so the summary is never blank.
  const mainValue = pos(e.estimated_value) || pos(pack0.main_property_value) || pos(pack0.property_value);
  const secValue = (mainValue + secs.reduce((a, s) => a + pos(s && s.estimated_value), 0))
    || pos(pack0.total_security_value) || pos(pack0.property_value);
  // Debt that STAYS ahead of us after completion. An outstanding loan marked
  // "To be repaid on completion" is cleared with our loan, so it is not deducted
  // (client sample: £133k gross on £190k value with £65k being cleared = 70% gross LTV).
  const stays = (s) => debtOf(s) - (yn(s && s.repaid_on_completion) === 'Yes' ? pos(s && s.outstanding_loan) : 0);
  const charges = stays(e) + secs.reduce((a, s) => a + stays(s), 0);
  const propertyValue = secValue - charges;
  const pack = pack0;
  const gross = num(terms.value);
  const rate = num(terms.ratePct);
  const net = num(pack.net_release_day1);
  // Day 1 LTV is shown against the SECURITY VALUE of the accepted indicative version
  // (client 05-10-2026), NOT the net-of-debt equity. Dividing by (securities - debt)
  // blows the % up for a 2nd charge where debt stays after completion
  // (e.g. gross 360,000 / (500,000 - 400,000) = 360%). Prefer the accepted indicative's
  // own security / property value; fall back to the securities' total value.
  const ltvBase = num(pack.total_security_value) || num(pack.property_value) || secValue;
  // Client 09-10-2026: the Gross LTV and Max LTV come from the selected INDICATIVE when it
  // carries them; otherwise fall back to computing Gross LTV from gross / security value.
  // Use the indicative's carried LTV only when it is a real positive figure; when the BDM
  // typed the gross/net amount directly the stored ltv_pct is 0, which must NOT print as
  // "0% Gross LTV" — fall back to gross / security value instead (client 09-10-2026).
  const carriedLtv = num(pack.ltv_pct);
  // Client 15-10-2026: the headline LTV is OUR loan's (gross ÷ security value) - the
  // indicative's carried % included the charge ahead on a 2nd charge, so it switched
  // meaning between deals. The total incl. other charges is its own figure (totalLtv).
  // Client 16-10-2026: the indicative's LTV when it carries one (same figure as the
  // enquiry / application); else the combined Est. LTV (gross + charges) ÷ value. No total.
  // Client 17-10-2026: fallback LTV = our loan only (gross ÷ value), charges not added.
  const grossLtv = (carriedLtv != null && carriedLtv > 0) ? carriedLtv
    : (gross && ltvBase > 0 ? (gross / ltvBase) * 100 : null);
  const totalLtv = null;
  const maxLtv = num(pack.max_ltv);
  const netLtv = net && ltvBase > 0 ? (net / ltvBase) * 100 : null;
  const exitFee = gross && rate ? Math.round(gross * rate) / 100 : null;   // 1 month's interest
  const equity = net !== null && propertyValue > 0 ? propertyValue - net : null;
  // Client 22-10-2026: capital stack uses the TOTAL net incl. drawdowns.
  const netTotal = pos(pack.net_release_incl_drawdowns) ? num(pack.net_release_incl_drawdowns) : net;
  const equityTotal = netTotal !== null && propertyValue > 0 ? propertyValue - netTotal : null;
  // Client 22-10-2026: GDV for the End After Drawdown LTVs (LTGDV) - the accepted
  // indicative's GDV, else the enquiry's main + additional securities' GDV.
  const gdv = pos(pack.gdv) || ((pos(e.gdv) + secs.reduce((a, s) => a + pos(s && s.gdv), 0)) || null);
  return { secs, mainValue, secValue, charges, propertyValue, ltvBase, gdv, netTotal, equityTotal, pack, gross, rate, net, grossLtv, netLtv, totalLtv, maxLtv, exitFee, equity };
}

/**
 * @param {object} e        enquiry (getById shape)
 * @param {object} terms    agreedTerms() result
 * @param {object} extra    { applicationRef, narrative, broker: {name,email,phone,...}, preparedBy }
 * @returns {Promise<Buffer>}
 */
async function buildDealSummaryPdf(e = {}, terms = {}, extra = {}) {
  const f = summaryFigures(e, terms);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const LEFT = 40;
  const RIGHT = doc.page.width - 40;
  const W = RIGHT - LEFT;
  const LABEL_W = 160;
  const BOTTOM = doc.page.height - 50;
  const ensure = (h) => { if (doc.y + h > BOTTOM) doc.addPage(); };

  // Header band (same ScotLend logo as the indicative / application form)
  const BAND_H = 56;
  doc.rect(0, 0, doc.page.width, BAND_H).fill(NAVY);
  if (LOGO) {
    const LH = 42; const LW = LH * LOGO_RATIO;
    doc.image(LOGO, (doc.page.width - LW) / 2, (BAND_H - LH) / 2, { width: LW, height: LH });
  } else {
    doc.fillColor(GOLD).fontSize(18).font('Helvetica-Bold').text('ScotLend Group', 0, 18, { width: doc.page.width, align: 'center' });
  }
  doc.y = 70;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text('Credit Deal Summary', LEFT, doc.y, { width: W, underline: true });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
    .text(`File Owner – ${e.assigned_to_name || '-'}`, LEFT, doc.y, { underline: true });
  doc.moveDown(0.15);
  // Client 14-10-2026: show Underwriter under File Owner (matches the client's
  // credit-paper header); the old grey Application/Enquiry/Prepared/Terms meta
  // line was removed at the client's request.
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
    .text(`Underwriter \u2013 ${e.underwriter_name || extra.underwriterName || '-'}`, LEFT, doc.y, { underline: true });
  doc.moveDown(0.8);

  // Bordered two-column table
  const table = (rows) => {
    const list = rows.filter(Boolean);
    list.forEach(([label, value], i) => {
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
  const heading = (t) => {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(t, LEFT, doc.y, { underline: true });
    doc.moveDown(0.35);
  };

  // ---- deal ----
  const applicants = Array.isArray(e.applicants) && e.applicants.length ? e.applicants
    : [{ full_name: e.applicant_name, email: e.email, mobile: e.phone }];
  const background = applicants.map((a) => join([
    [a.full_name, a.relationship ? `(${a.relationship})` : null].filter(Boolean).join(' '),
    a.occupation || a.employer_name ? `Occupation: ${join([a.occupation, a.employer_name ? 'at ' + a.employer_name : null], ' ')}` : null,
    a.owns_home != null ? `Owns own home: ${yn(a.owns_home)}` : null,
    a.prev_bridging != null ? `Previous bridging: ${yn(a.prev_bridging)}${a.prev_bridging_lender ? ' (' + a.prev_bridging_lender + ')' : ''}` : null,
    a.nationality ? `Nationality: ${a.nationality}` : null,
  ], '\n')).filter(Boolean).join('\n');

  // Postcode only when the address does not already contain it (was "…, SE1 9SG, United Kingdom, SE1 9SG").
  const addr = (s) => {
    const a = String(s.property_address || s.address || '').trim();
    const pc = String(s.postcode || '').trim();
    if (!pc || a.toUpperCase().replace(/\s/g, '').includes(pc.toUpperCase().replace(/\s/g, ''))) return a;
    return join([a, pc], ', ');
  };
  const addresses = join([
    addr(e) ? (f.secs.length ? '1. ' : '') + addr(e) : null,
    ...f.secs.map((s, i) => { const a = addr(s) || s.description; return a ? `${i + 2}. ${a}` : null; }),
  ]);
  const values = f.secs.length
    ? join([
      `Main: ${gbp(f.mainValue)}`,
      ...f.secs.map((s, i) => `Security ${i + 2}: ${gbp(pos(s.estimated_value))}`),
      `Total: ${gbp(f.secValue)}`,
    ])
    : gbp(f.mainValue);
  const debtLine = (s, lbl) => {
    const bits = [];
    if (pos(s.outstanding_loan)) bits.push(`${gbp(s.outstanding_loan)}${s.lender ? ' / ' + s.lender : ''}${s.repaid_on_completion != null ? (yn(s.repaid_on_completion) === 'Yes' ? ' – clearing with our loan' : ' – not repaid on completion') : ''}`);
    if (String(s.charge_type || '') === '2nd' && pos(s.charge_amount)) bits.push(`2nd charge ${gbp(s.charge_amount)}`);
    if (s.outstanding_loan == null && pos(s.existing_charge)) bits.push(`existing charge ${gbp(s.existing_charge)}`);
    return bits.length ? (lbl ? lbl + ': ' : '') + bits.join('; ') : null;
  };
  const debt = join([debtLine(e, f.secs.length ? 'Main' : ''), ...f.secs.map((s, i) => debtLine(s, `Security ${i + 2}`))]) || 'None';
  const dealType = join([
    e.charge_type ? `${e.charge_type} charge` : (f.pack.security_charge_type || null),
    e.product_name, e.interest_type ? `${e.interest_type} interest` : null,
  ], ' · ');
  const propDesc = join([
    join([e.property_type, e.tenure ? e.tenure + (e.tenure === 'Leasehold' && e.tenure_years != null ? ` (${e.tenure_years} yrs)` : '') : null], ', '),
    pos(e.gdv) ? `GDV: ${gbp(e.gdv)}` : null,
    pos(e.purchase_price) ? `Purchased for ${gbp(e.purchase_price)}${e.purchase_date ? ' on ' + dmy(e.purchase_date) : ''}` : null,
    e.added_value ? `Added value since purchase: ${e.added_value}` : null,
  ]);

  heading('Deal');
  table([
    ['Funding Line:', e.product_name],
    ['Borrower:', join([e.company_name, e.company_name && e.applicant_name ? `(${e.applicant_name})` : (!e.company_name ? e.applicant_name : null)], ' ')],
    ['Borrower Type:', e.applicant_type_name],
    ['Borrower Background & Experience:', background],
    ['Security Property Address(s):', addresses],
    ['Value:', values],
    ['Current Debt:', debt],
    ['Deal Type:', dealType],
    ['Loan Purpose:', e.purpose_name],
    ['Property Description:', propDesc],
    // Client 15-10-2026: typed on the enquiry (step 3 "Credit paper notes"); the deal
    // summary / notes text is the fallback for older enquiries.
    ['Deal Appraisal:', e.deal_appraisal || e.summary || ''],
    ['Exit Strategy:', e.exit_strategy || ''],
    ['Requested Completion:', dmy(e.requested_completion_date)],
  ]);

  // ---- location: a clickable Google Maps link per security (main + other securities), 29-09-2026 ----
  const maps = Array.isArray(extra.maps) ? extra.maps.filter((m) => m && m.url) : [];
  if (maps.length) {
    heading(maps.length > 1 ? 'Security Locations' : 'Security Location');
    for (const m of maps) {
      ensure(30);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
        .text(join([m.label, m.address], ' – ') || m.label, LEFT, doc.y, { width: W });
      doc.font('Helvetica').fontSize(8.5).fillColor('#1a56db')
        .text('Open in Google Maps', LEFT, doc.y, { link: m.url, underline: true });
      doc.moveDown(0.6);
    }
    doc.fillColor('#000000');
    doc.moveDown(0.3);
  }

  // ---- loan terms ----
  const p = f.pack;
  // Client 14-10-2026: same wording as the offer letter (feeLines).
  const { arrFee, brokerFee } = feeLines(p);
  const drawdowns = Array.isArray(p.drawdowns) && p.drawdowns.length
    ? p.drawdowns.map((d, i) => `Drawdown ${i + 1}: ${gbp(d.net != null ? d.net : d.amount)}${d.month != null ? ' – month ' + d.month : ''}`).join('\n')
    : '';
  // Client 20-10-2026: deals with drawdowns show Day 1 vs end figures and the interest split.
  const ddt = drawdownTerms(f);
  heading('Loan Terms');
  table([
    ['Gross Loan:', ddt ? ddt.gross : gbp(f.gross)],
    ['Net Loan:', ddt ? ddt.net : gbp(f.net)],
    // Client 09-10-2026: Day 1 LTV is simply the actual Net / Gross LTV as a % of the
    // security value — the "(debt staying ahead after completion … see Capital Stack)"
    // note is dropped (the Capital Stack row below still carries the net/equity split).
    ['LTV:', ddt ? ddt.ltv : (join([f.netLtv !== null ? `${pc(f.netLtv)} Net LTV` : null, f.grossLtv !== null ? `${pc(f.grossLtv)} Gross LTV` : null])
      + (f.maxLtv ? `\nMax LTV ${gbp(f.maxLtv)}` : '')
      + `\n(of security value ${gbp(f.ltvBase)})`)],
    ['Interest Rate:', f.rate ? `${pc(f.rate * 12)} p/a (${pc(f.rate)} pm)` : ''],
    ['Interest:', ddt ? ddt.interest : join([gbp(p.interest_total), p.interest_type ? `(${p.interest_type})` : null], ' ')],
    pos(p.monthly_payment) ? ['Monthly Payment:', gbp(p.monthly_payment)] : null,
    ['Term:', terms.term ? `${terms.term} months` : (e.term_months ? `${e.term_months} months` : '')],
    ['Security Address(s):', addresses],
    ['Charge:', dealType],
    drawdowns && !ddt ? ['Drawdowns:', drawdowns] : null,
    ['Arrangement Fee:', arrFee],
    ['Broker Fee:', brokerFee],
    ['Document Fee:', gbp(p.document_fee)],
    ['Exit Fee:', f.exitFee ? `1 month's equivalent interest of ${gbp(f.exitFee)}` : ''],
    ['Capital Stack:', f.netTotal !== null ? join([`${gbp(f.netTotal)} net`, f.equityTotal !== null ? `${gbp(f.equityTotal)} equity` : null]) : ''],
  ]);

  // ---- narrative ----
  if (extra.narrative && String(extra.narrative).trim()) {
    heading('Narrative / Notes');
    ensure(40);
    doc.font('Helvetica').fontSize(9).fillColor('#000000').text(String(extra.narrative).trim(), LEFT, doc.y, { width: W });
    doc.moveDown(1);
  }

  table([['Risk mitigants:', e.risk_mitigants || ''], ['Credit Recommendation:', e.credit_recommendation || '']]);

  heading('Credit Committee Use Only:');
  table([['Decision:', '[  ] Approve        [  ] Deny'], ['Date:', '____ / ____ / ________']]);

  // ---- introducer ----
  const b = extra.broker || {};
  ensure(50);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000');
  doc.text(`Introducer – ${b.name || e.broker_name || e.broker_name_text || '-'}`, LEFT, doc.y);
  doc.text(`Introducer email – ${b.email || e.broker_email || '-'}`, LEFT, doc.y);
  doc.text(`Introducer contact number/s – ${b.phone || b.mobile || b.contact_number || '-'}`, LEFT, doc.y);

  return toBuffer(doc);
}

/**
 * Arrangement / Broker Fee wording shared by the Credit Deal Summary PDF and the Credit
 * Paper .docx - identical to the offer letter (client 14-10-2026):
 *   Arrangement Fee: "£8,125.00 (of which £8,125.00 is payable to Thornton Mortgages)"
 *   Broker Fee:      "£4,062.50"
 * The "(of which ...)" part only appears when a broker is selected and a share is set,
 * exactly as on the offer letter.
 */
/**
 * Client 20-10-2026: Loan Terms for a deal WITH DRAWDOWNS, laid out like the indicative
 * terms - explicit Day 1 vs end (all drawdowns made) figures, so the gross / net / LTV no
 * longer mix the Day 1 net with the total gross. Returns null when there are no drawdowns
 * (the single-figure rows stay as they were).
 *   Day 1 gross   = total gross - Σ drawdown gross
 *   Day 1 net     = pack.net_release_day1
 *   End net       = Day 1 net + Σ drawdown net (pack.net_release_incl_drawdowns)
 *   LTVs          = Day 1 figure ÷ security value (f.ltvBase); End figure ÷ GDV (f.gdv)
 *   Interest      = initial (Day 1) retained interest, then each drawdown's own interest
 *                   (gross - net) with its predicted month; initial = total - Σ drawdown interest.
 */
function drawdownTerms(f = {}) {
  const p = f.pack || {};
  const dds = (Array.isArray(p.drawdowns) ? p.drawdowns : [])
    .map((d) => {
      const g = num(d.gross != null ? d.gross : d.amount);
      const n = num(d.net);
      const i = num(d.interest) != null ? num(d.interest) : (g !== null && n !== null ? Math.round((g - n) * 100) / 100 : null);
      return { month: d.month, gross: g, net: n, interest: i };
    })
    .filter((d) => pos(d.gross) || pos(d.net));
  if (!dds.length) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  const ddGross = num(p.drawdowns_total) !== null && pos(p.drawdowns_total) ? num(p.drawdowns_total) : r2(dds.reduce((a, d) => a + pos(d.gross), 0));
  const ddNet = num(p.drawdowns_net_total) !== null && pos(p.drawdowns_net_total) ? num(p.drawdowns_net_total) : r2(dds.reduce((a, d) => a + pos(d.net), 0));
  const totalGross = num(f.gross);
  const day1Gross = totalGross !== null ? r2(totalGross - ddGross) : null;
  const day1Net = num(p.net_release_day1);
  const endNet = num(p.net_release_incl_drawdowns) !== null && pos(p.net_release_incl_drawdowns)
    ? num(p.net_release_incl_drawdowns) : (day1Net !== null ? r2(day1Net + ddNet) : null);
  const base = num(f.ltvBase);
  // Client 20-10-2026: same wording / order as the Indicative Loan Terms PDF.
  const pct2 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '' : `${Number(v).toFixed(2)}%`);
  const ltvOf = (v) => (v !== null && base > 0 ? (v / base) * 100 : null);
  // Client 22-10-2026: End After Drawdown LTVs are against GDV (LTGDV), not the
  // purchase price / original value. Falls back to the security value when no GDV.
  const gdv = num(f.gdv);
  const endOf = (v) => (v !== null && gdv > 0 ? (v / gdv) * 100 : ltvOf(v));
  // Client 22-10-2026: worked out on GDV, but labelled Gross LTV / Net LTV.
  const endLbl = 'LTV';
  const ddLbl = (d) => (d.month != null && d.month !== '' ? `Drawdown - Month ${d.month}` : 'Drawdown');
  const ddInt = r2(dds.reduce((a, d) => a + pos(d.interest), 0));
  const totInt = num(p.interest_total);
  const initInt = totInt !== null ? r2(totInt - ddInt) : null;
  const rate = num(f.rate);
  return {
    // Client 20-10-2026: Gross Loan = the total only; LTV = two lines (Day 1 / End After Drawdown);
    // drawdown rows read "Drawdown - Month N" (no running number).
    gross: totalGross !== null ? `${gbp(totalGross)} (incl DDs)` : '',
    net: join([
      `Day 1 Net: ${gbp(day1Net)}`,
      ...dds.map((d) => `${ddLbl(d)}: ${gbp(d.net)}`),
      `Total Net incl. Drawdowns: ${gbp(endNet)}`,
    ]),
    ltv: join([
      `Day 1 - Gross LTV ${pct2(ltvOf(day1Gross))} / Net LTV ${pct2(ltvOf(day1Net))}`,
      `End After Drawdown - Gross ${endLbl} ${pct2(endOf(totalGross))} / Net ${endLbl} ${pct2(endOf(endNet))}`,
    ]),
    interest: join([
      `Retained Interest Day 1${rate ? ` (${rate}%)` : ''}: ${gbp(initInt)}`,
      ...dds.map((d) => `${ddLbl(d)}: ${gbp(d.interest)}`),
      `${p.interest_type === 'Serviced' ? 'Interest Total' : 'Retained Interest Total'}: ${gbp(totInt)}`,
    ]),
  };
}

function feeLines(p = {}) {
  const payable = pos(p.broker_fee_amount);
  const payee = p.broker_payee_name != null ? String(p.broker_payee_name).trim() : '';
  const part = payable && payee ? ` (of which ${gbp(payable)} is payable to ${payee})` : '';
  const arrFee = pos(p.arrangement_fee) ? `${gbp(p.arrangement_fee)}${part}` : '';
  const brokerFee = pos(p.broker_fee) ? gbp(p.broker_fee) : '';
  return { arrFee, brokerFee };
}

module.exports = { buildDealSummaryPdf, summaryFigures, feeLines, drawdownTerms, dmy };
