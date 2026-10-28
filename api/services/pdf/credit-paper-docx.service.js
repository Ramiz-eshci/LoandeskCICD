'use strict';

/**
 * Credit Paper (Credit Deal Summary) as an editable Word (.docx) document.
 * Client 09-10-2026: the underwriter downloads this with all the NUMERIC fields
 * pre-filled from the case, fills the narrative sections offline (Borrower
 * Background, Property Description, Deal Appraisal, Exit Strategy, Sq Ft &
 * Comparables, Risk Mitigants, Credit Recommendation), then re-uploads it.
 *
 * Four variants, chosen by applicant type (same data, different wording):
 *   England/Wales Individual · England/Wales Company · Scotland Individual · Scotland Company
 * The layout mirrors the client's samples (Liam Wallond / SPV TRG 001 Limited).
 *
 * The figures come from the SAME source as the Credit Deal Summary PDF
 * (summaryFigures over the accepted offer / indicative), so the two agree.
 */
const {
  Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun, ExternalHyperlink,
  WidthType, BorderStyle, AlignmentType,
} = require('docx');
const { summaryFigures, feeLines, drawdownTerms, dmy } = require('./deal-summary-pdf.service');
const { classifyApplicantType } = require('../../utils/applicant-type');

const num = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));
const pos = (n) => { const v = num(n); return v && v > 0 ? v : 0; };
const money = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbp = (n) => (num(n) === null ? '' : '£' + money(n));
const pc = (n) => (num(n) === null ? '' : (Math.round(Number(n) * 100) / 100) + '%');
const join = (parts, sep = '\n') => parts.filter((x) => x !== null && x !== undefined && String(x).trim() !== '').join(sep);

const SHADE = 'EAF0F6';
const NAVY = '0F2244';
const noBorderPair = { style: BorderStyle.SINGLE, size: 2, color: 'C8D8E8' };
const CELL_BORDERS = { top: noBorderPair, bottom: noBorderPair, left: noBorderPair, right: noBorderPair };

/** Build the 3–6 TextRuns of a multi-line cell (newlines become line breaks). */
function cellParas(value, opts = {}) {
  const text = value === null || value === undefined ? '' : String(value);
  const lines = text.split('\n');
  return lines.map((ln, i) => new Paragraph({
    children: [new TextRun({ text: ln, bold: !!opts.bold, color: opts.color || '000000', size: 18 })],
    spacing: { after: i === lines.length - 1 ? 0 : 20 },
  }));
}

function labelCell(text) {
  return new TableCell({
    width: { size: 34, type: WidthType.PERCENTAGE },
    shading: { fill: SHADE },
    borders: CELL_BORDERS,
    children: cellParas(text, { bold: true, color: NAVY }),
  });
}
function valueCell(text) {
  return new TableCell({
    width: { size: 66, type: WidthType.PERCENTAGE },
    borders: CELL_BORDERS,
    children: cellParas(text),
  });
}
/** A label/value row. value === null → a blank cell the underwriter fills in. */
function row(label, value) {
  return new TableRow({ children: [labelCell(label), valueCell(value == null ? '' : value)] });
}
function kvTable(rows) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}
function heading(text) {
  return new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text, bold: true, color: NAVY, size: 22 })] });
}

/**
 * @param {object} e      enquiry (getById shape) — carries securities, applicant, etc.
 * @param {object} terms  agreedTerms() result ({ value, term, ratePct, source, pack })
 * @param {object} extra  case-specific fields from the underwriting steps:
 *   { fileOwner, underwriter, valuationType, valuer, siteVisit, dualRep,
 *     additionalSecurityDocs, fundingLine, purchasePrice, marketValue, currentDebt,
 *     totalGrossProfit, irrPct, seniorLender, introducer:{name,email,phone} }
 */
async function buildCreditPaperDocx(e = {}, terms = {}, extra = {}) {
  const f = summaryFigures(e, terms);
  const p = f.pack || {};
  const cls = classifyApplicantType(e.applicant_type_name);
  const isCompany = cls.isCompany;
  const region = cls.region; // 'SCOTLAND' | 'EW'

  // ---- addresses (main + additional securities) ----
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
  ]) || '';

  // Client 16-10-2026: same Deal Type line as the short Credit Deal Summary
  // ("1st charge · 1st and 2nd Charge Bridge · Retained interest").
  const dealType = join([
    e.charge_type ? `${e.charge_type} charge` : (p.security_charge_type || null),
    e.product_name, e.interest_type ? `${e.interest_type} interest` : (p.interest_type ? `${p.interest_type} interest` : null),
  ], ' · ') || (e.product_name || '');

  // ---- fees ----
  // Client 14-10-2026: Arrangement / Broker Fee wording identical to the offer letter
  // (shared helper with the Credit Deal Summary PDF).
  const { brokerFee: brokerFee0 } = feeLines(p);
  const brokerFee = brokerFee0 || '£nil';
  // Client 19-10-2026 (Liam Wallond sample): "£12,600 (2%) of which £6,300 (1%) is payable
  // to Finspace Group Limited", then the broker contact / email / phone as bullets.
  const brokerShare = pos(p.broker_fee_amount);
  const payee = p.broker_payee_name != null ? String(p.broker_payee_name).trim() : '';
  const ofGross = (v) => (pos(f.gross) ? ` (${pc((v / f.gross) * 100)})` : '');
  const arrFee = pos(p.arrangement_fee)
    ? `${gbp(p.arrangement_fee)}${ofGross(p.arrangement_fee)}`
      + (brokerShare && payee ? ` of which ${gbp(brokerShare)}${ofGross(brokerShare)} is payable to ${payee}` : '')
    : '';
  const brk = extra.introducer || {};
  const brokerBullets = brokerShare && payee
    ? [brk.contact, brk.email, brk.phone].map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const arrFeeCell = () => {
    const paras = [new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: arrFee, size: 18 })] })];
    for (const b of brokerBullets) {
      const isEmail = b === String(brk.email || '').trim();
      paras.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 20 },
        children: [isEmail
          ? new ExternalHyperlink({ link: `mailto:${b}`, children: [new TextRun({ text: b, size: 18, color: '0563C1', underline: {} })] })
          : new TextRun({ text: b, size: 18 })],
      }));
    }
    return new TableCell({ width: { size: 66, type: WidthType.PERCENTAGE }, borders: CELL_BORDERS, children: paras });
  };

  // Total Gross Profit = interest + lender's share of the arrangement fee + document fee +
  // exit fee (matches the client sample: 90,720 + 6,300 + 1,000 + 7,560 = £105,580).
  // A stored lender_income on the application still wins.
  const grossProfit = extra.totalGrossProfit != null ? extra.totalGrossProfit
    : (pos(p.interest_total) || pos(p.arrangement_fee) || pos(p.document_fee) || pos(f.exitFee)
      ? pos(p.interest_total) + Math.max(0, pos(p.arrangement_fee) - brokerShare) + pos(p.document_fee) + pos(f.exitFee)
      : null);

  // IRR on Net - client's "Loandesk IRR Calculator" sheet (client 19-10-2026), always on the
  // rolled-up basis: outlay at month 0 = Net (Gross - Gross*months*rate - Arrangement Fee -
  // Borrower Broker Fee - Document Fee) + Borrower Broker Fee + Loandesk Broker Fee; the only
  // inflow is Gross + Exit Fee at month n. IRR = monthly IRR * 12. With a single inflow the
  // Excel IRR is closed-form: (in/out)^(1/n) - 1. Liam Wallond sample -> 16.10%.
  const irrMonths = num(terms.term || e.term_months);
  const irrPct = (() => {
    if (extra.irrPct != null) return extra.irrPct;
    if (!pos(f.gross) || !pos(f.rate) || !irrMonths || irrMonths <= 0) return null;
    const borrowerBroker = pos(p.broker_fee != null ? p.broker_fee : p.broker_fee_base);
    const net = f.gross - f.gross * irrMonths * (f.rate / 100) - pos(p.arrangement_fee) - borrowerBroker - pos(p.document_fee);
    const outlay = net + borrowerBroker + brokerShare;
    const inflow = f.gross + pos(f.exitFee);
    if (!(outlay > 0)) return null;
    return (Math.pow(inflow / outlay, 1 / irrMonths) - 1) * 12 * 100;
  })();

  // ---- funding line (lending entity) by jurisdiction; editable afterwards ----
  const fundingLine = extra.fundingLine || (region === 'SCOTLAND' ? 'ScotLend (DC) Limited' : 'ScotLend (SB) Limited');

  // ---- borrower line ----
  const indivContact = join([e.applicant_name, e.phone, e.email], ' – ');
  const borrower = isCompany
    ? join([
      join([e.company_name, e.company_reg_no], ' – '),
      e.applicant_name ? `Director: ${join([e.applicant_name, join([e.phone, e.email], ' / ')], ' – ')}` : null,
    ])
    : indivContact;

  // ---- value / debt / capital stack ----
  const purchasePrice = extra.purchasePrice != null ? extra.purchasePrice : (e.purchase_price != null ? e.purchase_price : null);
  const marketValue = extra.marketValue != null ? extra.marketValue : f.mainValue;
  // Client 15-10-2026 (sample credit paper): "Market Value: £119,000 with 4.1 confidence
  // level" (AVM confidence from underwriting step Valuation) and, when the purchase price is
  // below the market value, "Purchase Price: £80,000*" + an italic
  // "*Note: we are lending off of the purchase price".
  const conf = extra.confidenceLevel != null && String(extra.confidenceLevel).trim() !== '' ? String(extra.confidenceLevel).trim() : null;
  const lendOffPurchase = pos(purchasePrice) && pos(marketValue) && Number(purchasePrice) < Number(marketValue);
  // Client 16-10-2026: with several securities the value is broken down per security
  // (Main / Security 2 / ... / Total) exactly like the short Credit Deal Summary - it was
  // only showing the first property's value.
  const multi = f.secs.length > 0;
  const valueLines = multi
    ? [
      // Client 16-10-2026: several securities -> only the per-security values + Total
      // (no Purchase Price line / "lending off the purchase price" note).
      `Main: ${gbp(f.mainValue)}`,
      ...f.secs.map((s, i) => `Security ${i + 2}: ${gbp(pos(s.estimated_value))}`),
      `Total: ${gbp(f.secValue)}${conf ? ` (valuation confidence level ${conf})` : ''}`,
    ].filter(Boolean)
    : [
      purchasePrice != null ? `Purchase Price: ${gbp(purchasePrice)}${lendOffPurchase ? '*' : ''}` : null,
      marketValue != null ? `Market Value: ${gbp(marketValue)}${conf ? ` with ${conf} confidence level` : ''}` : null,
    ].filter(Boolean);
  const valueCellRich = () => {
    const paras = (valueLines.length ? valueLines : ['']).map((t) => new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: t, size: 18 })] }));
    if (lendOffPurchase && !multi) {
      paras.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: '', size: 18 })] }));
      paras.push(new Paragraph({ children: [new TextRun({ text: '*Note: we are lending off of the purchase price', italics: true, size: 18 })] }));
    }
    return new TableCell({ width: { size: 66, type: WidthType.PERCENTAGE }, borders: CELL_BORDERS, children: paras });
  };
  // Current debt per security (client 16-10-2026) - same wording as the short summary:
  // "Security 3: 2nd charge £100,000.00".
  const yn = (v) => (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'yes' ? 'Yes' : 'No');
  const debtLine = (s, lbl) => {
    const bits = [];
    if (pos(s.outstanding_loan)) bits.push(`${gbp(s.outstanding_loan)}${s.lender ? ' / ' + s.lender : ''}${s.repaid_on_completion != null ? (yn(s.repaid_on_completion) === 'Yes' ? ' – clearing with our loan' : ' – not repaid on completion') : ''}`);
    if (String(s.charge_type || '') === '2nd' && pos(s.charge_amount)) bits.push(`2nd charge ${gbp(s.charge_amount)}`);
    if (s.outstanding_loan == null && pos(s.existing_charge)) bits.push(`existing charge ${gbp(s.existing_charge)}`);
    return bits.length ? (lbl ? lbl + ': ' : '') + bits.join('; ') : null;
  };
  const debtAll = multi
    ? join([debtLine(e, 'Main'), ...f.secs.map((s, i) => debtLine(s, `Security ${i + 2}`))])
    : (pos(e.outstanding_loan) ? gbp(e.outstanding_loan) : '');
  const currentDebt = extra.currentDebt != null ? String(extra.currentDebt) : (debtAll || 'None – Purchase');
  const capitalStack = join([
    f.netTotal != null ? `Our Net Loan: ${gbp(f.netTotal)}` : null,
    f.equityTotal != null ? `Equity: ${gbp(f.equityTotal)}` : null,
  ]);

  // Client 16-10-2026: left blank to fill in by hand - other security documents (e.g. a
  // Personal Guarantee) depend on the deal, even for an individual borrower.
  const addlSecDocs = extra.additionalSecurityDocs || null;

  // Tester 20-10-2026 (client SPV TRG 001 sample): Day 1 LTV "against PP" (purchase price) and
  // "against MV" (market value), Net then Gross:
  //   55.12% Net LTV against PP / 70% Gross LTV against PP / (blank) / 37.1% Net LTV against MV / ...
  // PP lines only when there is a purchase price (single security); MV is the valuation's market
  // value, else the security value the LTV is based on (several securities -> total value).
  const ratio = (amt, base) => (pos(amt) && pos(base) ? (Number(amt) / Number(base)) * 100 : null);
  const mvBase = multi ? pos(f.ltvBase) : (pos(marketValue) || pos(f.ltvBase));
  const sameAsBase = pos(f.ltvBase) && Math.abs(Number(mvBase) - Number(f.ltvBase)) < 0.005;
  const netMv = sameAsBase && f.netLtv !== null ? f.netLtv : ratio(f.net, mvBase);
  const grossMv = sameAsBase && f.grossLtv !== null ? f.grossLtv : ratio(f.gross, mvBase);
  const ppBase = !multi ? pos(purchasePrice) : 0;
  const ppLines = ppBase ? [
    ratio(f.net, ppBase) !== null ? `${pc(ratio(f.net, ppBase))} Net LTV against PP` : null,
    ratio(f.gross, ppBase) !== null ? `${pc(ratio(f.gross, ppBase))} Gross LTV against PP` : null,
  ].filter(Boolean) : [];
  const mvLines = [
    netMv !== null ? `${pc(netMv)} Net LTV against MV` : null,
    grossMv !== null ? `${pc(grossMv)} Gross LTV against MV` : null,
  ].filter(Boolean);
  const dayOneLtv = [join(ppLines), join(mvLines)].filter(Boolean).join('\n\n')
    + (f.maxLtv ? `\nMax LTV ${gbp(f.maxLtv)}` : '');

  // Client 23-10-2026: same wording as the client's sample credit papers (England and
  // Scotland alike): "1st charge bridge" / "2nd charge bridge" - the ranking always shows
  // (was "standard security" for Scotland, which hid 1st vs 2nd).
  const chargeOne = (ct) => (String(ct || '').trim().startsWith('2nd') ? '2nd charge bridge'
    : (String(ct || '').trim().startsWith('1st') ? '1st charge bridge' : null));
  // Client 23-10-2026: Charge = the PRODUCT chosen on the enquiry (sample papers: "1st charge
  // bridge" = product "1st Charge Bridge"), written in lower case like the samples.
  // Ranking per security is only the fallback when no product is set.
  const productCharge = String(e.product_name || '').trim();
  const chargeLabel = productCharge ? productCharge.toLowerCase() : multi
    ? join([
      `1. ${chargeOne(e.charge_type) || '1st charge bridge'}`,
      ...f.secs.map((s, i) => `${i + 2}. ${chargeOne(s.charge_type) || '1st charge bridge'}`),
    ])
    : (chargeOne(e.charge_type) || chargeOne(p.security_charge_type) || '1st charge bridge');

  // Property Description: every security address (main + others) with a Google Maps link.
  const mapUrl = (a, pc) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([a, pc].filter(Boolean).join(', '));
  const descItems = [];
  if (e.property_address) descItems.push({ a: e.property_address, pc: e.postcode });
  for (const sx of f.secs) {
    const a = sx.property_address || sx.address || sx.description;
    if (a) descItems.push({ a, pc: sx.postcode });
  }
  const propertyDescCell = () => {
    if (!descItems.length) return valueCell('');
    const paras = descItems.map((it) => new Paragraph({
      spacing: { after: 20 },
      children: [
        new TextRun({ text: addr({ address: it.a, postcode: it.pc }) + '  ', size: 18 }),
        new ExternalHyperlink({ link: mapUrl(it.a, it.pc), children: [new TextRun({ text: 'View on Google Maps', size: 18, color: '0563C1', underline: {} })] }),
      ],
    }));
    return new TableCell({ width: { size: 66, type: WidthType.PERCENTAGE }, borders: CELL_BORDERS, children: paras });
  };

  // ---- Table 0: deal info ----
  const t0 = kvTable([
    row('Funding Line:', fundingLine),
    row('Borrower:', borrower),
    // Client 16-10-2026: left blank to be written by hand.
    row('Borrower Background & Experience:', null),
    row('Security Property Address(s):', addresses),
    new TableRow({ children: [labelCell('Value:'), valueCellRich()] }),
    row('Current Debt:', currentDebt),
    row('Dual Rep:', extra.dualRep != null ? extra.dualRep : ''),
    row('Valuation Type', extra.valuationType || ''),
    row('Valuer:', extra.valuer || ''),
    // No site visit recorded -> N/A (client 15-10-2026), not a blank cell.
    row('Site Visit:', extra.siteVisit || 'N/A'),
    row('Deal Type:', dealType),
    new TableRow({ children: [labelCell('Property Description:'), propertyDescCell()] }),
    // Client 15-10-2026: from the enquiry (step 3 "Credit paper notes"), optional.
    row('Deal Appraisal:', e.deal_appraisal || e.summary || null),
    row('Exit strategy', e.exit_strategy || null),
    row('Requested Completion:', e.requested_completion_date ? dmy(e.requested_completion_date) : null),
    row('Sq. Ft & Comparable Info:', null),
    // Client 15-10-2026: their template repeats Current Debt here, after the comparables -
    // the debt figure when there is one, otherwise N/A (top row keeps "None – Purchase").
    row('Current Debt:', extra.currentDebt != null ? String(extra.currentDebt) : (debtAll || 'N/A')),
    row('Capital Stack:', capitalStack),
  ]);

  // ---- Table 1: loan terms ----
  // Client 20-10-2026: with drawdowns, explicit Day 1 vs end gross / net / LTV and the
  // interest split into the initial amount + each drawdown (with its predicted month).
  const ddt = drawdownTerms(f);
  const t1 = kvTable([
    row('Gross Loan:', ddt ? ddt.gross : gbp(f.gross)),
    row('Net Loan:', ddt ? ddt.net : gbp(f.net)),
    row(ddt ? 'LTV:' : 'Day 1 LTV:', ddt ? ddt.ltv : dayOneLtv),
    row('Interest Rate:', f.rate ? `${pc(f.rate * 12)} p/a (${pc(f.rate)} pm)` : ''),
    row('Interest:', ddt ? ddt.interest : join([gbp(p.interest_total), p.interest_type ? `(${p.interest_type})` : null], ' ')),
    row('Term:', (terms.term || e.term_months) ? `${terms.term || e.term_months} months with a minimum term of 3 months` : ''),
    row('Security address(s):', addresses),
    row('Charge:', chargeLabel),
    row('Additional security documents:', addlSecDocs),
    row('Senior Lender:', extra.seniorLender || 'n/a'),
    row('Total Gross Profit:', grossProfit != null ? gbp(grossProfit) : ''),
    row('IRR on Net:', irrPct != null ? `${(Math.round(irrPct * 100) / 100).toFixed(2)}%` : ''),
    new TableRow({ children: [labelCell('Arrangement Fee:'), arrFeeCell()] }),
    row('Broker Fee:', brokerFee),
    row('Document Fee:', p.document_fee != null ? gbp(p.document_fee) : ''),
    row('Exit Fee:', f.exitFee ? `1 month's equivalent interest of ${gbp(f.exitFee)}` : ''),
  ]);

  // ---- Table 2: risk / recommendation (narrative, blank) ----
  const t2 = kvTable([
    // Enquiry text first (client 15-10-2026), then what underwriting adds.
    row('Risk mitigants:', join([e.risk_mitigants, extra.riskMitigants], '\n\n') || null),
    row('Credit Recommendation', join([e.credit_recommendation, extra.creditRecommendation], '\n\n') || null),
  ]);

  // ---- Table 3: committee use (blank) ----
  const t3 = kvTable([
    row('Decision:', null),
    row('Date:', null),
  ]);

  const headPara = (text, bold) => new Paragraph({ children: [new TextRun({ text, bold: !!bold, color: NAVY, size: bold ? 26 : 20 })], spacing: { after: 60 } });

  const intro = [
    headPara('Credit Deal Summary', true),
    headPara(`File Owner – ${extra.fileOwner || e.assigned_to_name || '-'}`),
    headPara(`Underwriter – ${extra.underwriter || '-'}`),
  ];
  // Client 16-10-2026: Introducer block moved to the BOTTOM (after Credit Committee Use Only),
  // bold, as in the client's credit paper.
  const footer = [];
  if (isCompany && extra.introducer) {
    const footPara = (text) => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text, bold: true, size: 20 })] });
    footer.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    footer.push(footPara(`Introducer – ${extra.introducer.name || e.broker_name || '-'}`));
    footer.push(footPara(`Introducer email – ${extra.introducer.email || e.broker_email || '-'}`));
    footer.push(footPara(`Introducer contact number/s – ${extra.introducer.phone || '-'}`));
  }

  const doc = new Document({
    creator: 'LoanDesk',
    title: 'Credit Deal Summary',
    sections: [{
      children: [
        ...intro,
        new Paragraph({ spacing: { after: 80 }, children: [] }),
        t0,
        heading('Loan Terms'),
        t1,
        new Paragraph({ spacing: { after: 80 }, children: [] }),
        t2,
        heading('Credit Committee Use Only:'),
        t3,
        ...footer,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildCreditPaperDocx };
