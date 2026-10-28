'use strict';

/**
 * Indicative loan-terms calculation engine (Module-4).
 *
 * PURE + deterministic (no DB) so it is unit-testable and safe to call from the
 * live-preview endpoint.
 *
 * RECONCILED to the penny against the client's four calc workbooks:
 *   - Calc monthly serviced.xlsx  (Serviced, no deductible interest)
 *   - Calc with DDs.xlsx          (Retained + future drawdowns)
 *   - 2nd CB Calc Current.xlsx    (Retained + existing 1st charge)
 *   - Bridge Calc Current.xlsx    (Retained, plain bridge)
 *
 * THE MODEL (identical across all four sheets):
 *   max_ltv          = property_value x max_ltv%
 *   base_gross       = max_ltv - existing_1st_charge          (the "Gross Loan")
 *   total_gross      = base_gross + Σ drawdown_gross          ("Total Gross Loan incl DDs")
 *   arrangement_fee  = arr% x total_gross        (fees are on the TOTAL gross incl DDs)
 *   broker_fee       = broker% x total_gross
 *   -- SERVICED: interest is NOT deducted; it is paid monthly.
 *        interest_calc    = base_gross x annual%   (annual = monthly x 16 - 2.4: 1.05->14.4, 1.15->16, 1.25->17.6)
 *        monthly_payment  = interest_calc / term_months
 *        deductions       = arrangement + broker + document
 *   -- RETAINED: whole-term interest is deducted day 1.
 *        retained_day1    = base_gross x monthly_rate x term
 *        drawdown_int_i   = dd_gross_i x (term - month_i) x monthly_rate
 *        retained_total   = retained_day1 + Σ drawdown_int_i
 *        deductions       = arrangement + broker + document + retained_day1
 *   day1_net         = base_gross - deductions
 *   drawdown_net_i   = dd_gross_i - drawdown_int_i            (retained) | dd_gross_i (serviced)
 *   total_net_incl_dd= day1_net + Σ drawdown_net_i
 *   ltgdv%           = total_gross / gdv
 *   actual_total_ltv%= (total_gross + 1st_charge) / property
 *
 * NO DEFAULTS: an empty box yields null and every figure derived from it is null
 * too, so the table never invents a number the BDM did not type.
 */

const { OFFER_DEFAULTS } = require('../config/enquiry.config');

const MIN_TERM_MONTHS = OFFER_DEFAULTS.min_term_months;

const nul = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => (n === null ? null : Math.round((n + Number.EPSILON) * 100) / 100);
const mul = (...xs) => (xs.some((x) => x === null) ? null : xs.reduce((a, b) => a * b, 1));

/** Money typed as text on the enquiry ("250,000", "£1,000") -> number | null. */
const money = (v) => nul(typeof v === 'string' ? v.replace(/[£,\s]/g, '') : v);

function computeIndicative(inputs = {}) {
  // OTHER / ADDITIONAL SECURITIES (client point #5): each ticked security adds its value
  // to the security pot and its existing charge to the debt ranking ahead of us, so
  //   total security value = main property + Σ additional values
  //   charges ahead        = main 1st charge + Σ additional existing charges
  // and LTV / Max LTV / gross all work off those totals.
  const addSecs = Array.isArray(inputs.additional_securities)
    ? inputs.additional_securities.map((x) => ({
      address: String((x && (x.address || x.description)) || '').trim(),
      security_type: String((x && x.security_type) || '').trim(),
      value: money(x && (x.value !== undefined ? x.value : x.estimated_value)),
      existing_charge: money(x && x.existing_charge),
      include: !(x && (x.include === false || x.include === 'false')),
    }))
    : [];
  const addIncluded = addSecs.filter((x) => x.include && ((x.value || 0) > 0 || (x.existing_charge || 0) > 0));
  const addValue = round2(addIncluded.reduce((a, x) => a + (x.value || 0), 0));
  const addCharges = round2(addIncluded.reduce((a, x) => a + (x.existing_charge || 0), 0));
  // NET model (client 29-09-2026, all four calculators):
  //   Security Value  = main current value + Σ other securities' current values
  //   Property Value  = Security Value - Σ outstanding loans - Σ 2nd-charge amounts
  //                     (auto-filled in the popup, editable)
  //   Max LTV £ / loan = Property Value x LTV%          (% mode)
  //   loan = typed £, LTV% = loan / Property Value       (£ mode)
  //   Est. LTV        = (total gross + outstanding loans + 2nd charges) / Security Value
  // The front sends value_model = 'net', property_value = NET, security_value = gross total,
  // charges_total = all outstanding loans + 2nd charges. Versions saved before this
  // (no value_model) keep the old model below so re-opening them does not change them.
  const netModel = inputs.value_model === 'net';
  const mainValue = netModel ? nul(inputs.main_security_value) : nul(inputs.property_value);
  const mainCharge = netModel ? (nul(inputs.main_charges) || 0) : (nul(inputs.first_charge) || 0);
  const netValue = netModel ? nul(inputs.property_value) : null;
  const netCharges = netModel ? round2(nul(inputs.charges_total) || 0) : null;
  const propertyValue = netModel
    ? (nul(inputs.security_value) !== null ? round2(nul(inputs.security_value))
      : (netValue === null ? null : round2(netValue + netCharges)))
    : (mainValue === null && !addValue ? null : round2((mainValue || 0) + addValue));
  const gdv = nul(inputs.gdv);
  // LTV box has two modes (client point: "enter the % LTV or just the real amount").
  //   'pct'    -> gross = property value x LTV% (the sheet's Max LTV)
  //   'amount' -> the BDM types the loan amount itself; LTV is back-solved from it.
  const ltvMode = inputs.ltv_mode === 'amount' ? 'amount' : 'pct';
  const ltvPct = ltvMode === 'amount' ? null : nul(inputs.ltv_pct);
  const termMonths = nul(inputs.term_months);
  const monthlyRate = nul(inputs.monthly_rate_pct);
  const firstCharge = netModel ? netCharges : round2(mainCharge + addCharges);
  const rate = monthlyRate === null ? null : monthlyRate / 100;

  const arrangementIsPct = !(inputs.arrangement_fee_is_pct === false || inputs.arrangement_fee_is_pct === 'false');
  const arrangementVal = nul(inputs.arrangement_fee_pct);
  const brokerIsPct = !(inputs.broker_fee_is_pct === false || inputs.broker_fee_is_pct === 'false');
  const brokerVal = nul(inputs.broker_fee);
  const documentFee = nul(inputs.document_fee);

  // Rolled Up removed at the client's request — only Serviced and Retained.
  const TYPES = ['Serviced', 'Retained'];
  const interestType = TYPES.includes(inputs.interest_type) ? inputs.interest_type : 'Retained';
  // Which client workbook the popup follows (layout only; maths is the shared model above).
  const CALC_TYPES = ['dds', 'bridge', 'second_charge', 'serviced'];
  const calcType = CALC_TYPES.includes(inputs.calc_type) ? inputs.calc_type : (interestType === 'Serviced' ? 'serviced' : 'dds');
  // Calc monthly serviced.xlsx: monthly interest = gross x annual 'Interest calc' rate / 12.
  const annualRate = nul(inputs.annual_rate_pct);

  // Drawdowns: the BDM types the NET amount the borrower receives (client point #2).
  // Old saved versions carry only the gross `amount` - those still work unchanged.
  const drawdowns = Array.isArray(inputs.drawdowns)
    ? inputs.drawdowns.map((d) => ({ month: nul(d && d.month), amount: nul(d && d.amount), net: nul(d && d.net) }))
      .filter((d) => (d.net !== null && d.net > 0) || (d.amount !== null && d.amount > 0))
    : [];

  // Base gross (the "Gross Loan"): a typed override, else Max LTV minus any existing 1st charge.
  const override = round2(nul(inputs.gross_loan));
  // Amount mode: the "Max LTV" figure is the typed loan (+ any 1st charge ahead of it),
  // so the table/PDF still read LTV % -> £ on one row.
  // Client 28-09-2026 (all calculators except "Retained with 2nd charge", which keeps its
  // reconciled sheet model): the LTV % applies to the EQUITY left after outstanding loans,
  //   loan = (security value - outstanding loans - existing charges) x LTV%
  // e.g. (400,000 - 100,000 outstanding - 100,000 2nd charge) x 50% = 100,000.
  // 2nd-charge sheet: loan = security value x LTV% - 1st charge (unchanged).
  const equityModel = netModel || calcType !== 'second_charge';
  const equity = netModel ? netValue : (propertyValue === null ? null : round2(propertyValue - firstCharge));
  let maxLtv;
  if (ltvMode === 'amount') {
    maxLtv = (override !== null && override > 0) ? (equityModel ? override : round2(override + firstCharge)) : null;
  } else if (equityModel) {
    maxLtv = (equity === null || equity <= 0 || ltvPct === null) ? null : round2(equity * (ltvPct / 100));
  } else {
    maxLtv = round2(mul(propertyValue, ltvPct === null ? null : ltvPct / 100));
  }
  const base = (override !== null && override > 0)
    ? override
    : (maxLtv === null ? null : (equityModel ? maxLtv : round2(maxLtv - firstCharge)));

  const ready = base !== null && base > 0 && propertyValue !== null && propertyValue > 0
    && (!netModel || (netValue !== null && netValue > 0));

  // Future drawdowns: each accrues interest for its remaining months (term - month).
  let drawdownsSum = 0;
  let drawdownRetained = 0;
  let drawdownNetSum = 0;
  const drawdownRows = [];
  const ddWarnings = [];
  drawdowns.forEach((d, i) => {
    const monthsLeft = (termMonths !== null && d.month !== null) ? Math.max(0, termMonths - d.month) : 0;
    // Share of the drawdown eaten by its retained interest (term - month) x rate.
    const k = (rate !== null && interestType === 'Retained') ? monthsLeft * rate : 0;
    let g; let interest; let net;
    if (d.net !== null && d.net > 0) {
      // Net typed -> gross back-solved: gross = net / (1 - months x rate). The typed net
      // is kept to the penny; interest is the difference.
      if (k >= 1) {
        ddWarnings.push(`Drawdown ${i + 1}: interest for ${monthsLeft} months at this rate uses up the whole drawdown - check the month / rate.`);
        return;
      }
      net = round2(d.net);
      g = round2(net / (1 - k));
      interest = round2(g - net);
    } else {
      // Legacy (gross typed): interest = gross x months x rate, net = gross - interest.
      g = d.amount;
      interest = k ? round2(g * k) : 0;
      net = round2(g - interest);
    }
    drawdownsSum += g;
    drawdownRetained += interest || 0;
    drawdownNetSum += net || 0;
    drawdownRows.push({ month: d.month, amount: g, months_left: monthsLeft, interest, net });
  });
  drawdownRetained = round2(drawdownRetained);
  drawdownsSum = round2(drawdownsSum);
  drawdownNetSum = round2(drawdownNetSum);

  // Total Gross Loan incl DDs = base gross + Σ drawdown gross (interest is NOT added in).
  const totalGrossInclDDs = round2((base || 0) + (drawdownsSum || 0));

  // Fees are charged on the TOTAL gross incl DDs.
  const feeBase = totalGrossInclDDs;
  const arrangementFee = round2(arrangementIsPct ? mul(feeBase, arrangementVal === null ? null : arrangementVal / 100) : arrangementVal);
  const brokerFee = round2(brokerIsPct ? mul(feeBase, brokerVal === null ? null : brokerVal / 100) : brokerVal);

  // Retained interest (day 1) — only for the Retained type.
  const retainedDay1 = interestType === 'Retained' ? round2(mul(base, rate, termMonths)) : null;
  const retainedTotal = interestType === 'Retained' ? round2((retainedDay1 || 0) + (drawdownRetained || 0)) : null;

  // Serviced interest is paid monthly, not deducted. Monthly = gross x annual% / term, NEVER
  // gross x monthly%. The annual 'Interest calc' rate is DERIVED from the monthly rate along
  // the straight line through the client's example rows (1.05% -> 14.4%, 1.15% -> 16%,
  // 1.25% -> 17.6%): each +0.10 monthly adds +1.60 annual, i.e. annual = monthly*16 - 2.4.
  // This auto-calculates for ANY monthly rate (not just the 3 example rows); the old fixed
  // rate card / monthly*12 fallback is gone. Confirmed 02-10-2026 by the client: gross
  // 1,225,000 @ 1.05% monthly, 12m -> annual 14.4% -> monthly interest 14,700.
  const servicedAnnualFromMonthly = (m) => (m === null ? null : round2(m * 16 - 2.4));
  const servicedAnnual = interestType === 'Serviced'
    ? (annualRate !== null ? annualRate : servicedAnnualFromMonthly(monthlyRate))
    : null;
  // Client 22-10-2026 (Calc monthly serviced.xlsx): Interest calc = gross x annual% (I3) and
  // Monthly Interest = Interest calc / TERM in months (I6 = I3 / D15) - not / 12.
  const monthlyPayment = interestType === 'Serviced'
    ? (base === null || servicedAnnual === null || !termMonths ? null : round2((base * servicedAnnual) / 100 / termMonths))
    : null;
  const servicedInterestTotal = interestType === 'Serviced' ? round2(mul(monthlyPayment, termMonths)) : null;
  // Bridge / 2nd charge sheets show the monthly interest on the gross loan ("Monthly Rate" row).
  const monthlyInterest = round2(mul(base, rate));

  // Deductions differ by type: serviced deducts fees only; retained also deducts day-1 interest.
  const retainedInDeductions = interestType === 'Retained' ? (retainedDay1 || 0) : 0;
  const day1TotalDeductions = round2((arrangementFee || 0) + (documentFee || 0) + (brokerFee || 0) + retainedInDeductions);
  const day1Net = round2(base === null ? null : base - day1TotalDeductions);
  const totalNetInclDrawdowns = round2((day1Net || 0) + (drawdownNetSum || 0));

  const ltgdvPct = (gdv !== null && gdv > 0) ? round2((totalGrossInclDDs / gdv) * 100) : null;
  const actualTotalLtvPct = (propertyValue !== null && propertyValue > 0) ? round2(((totalGrossInclDDs + firstCharge) / propertyValue) * 100) : null;
  // If a gross override was entered, LTV back-solves from it; otherwise echo the entered LTV.
  const impliedLtvPct = (override !== null && override > 0 && ((netModel && equity > 0) || (propertyValue !== null && propertyValue > 0)))
    ? (equityModel
      ? (equity !== null && equity > 0 ? round2((base / equity) * 100) : null)
      : round2(((base + firstCharge) / propertyValue) * 100))
    : ltvPct;

  const warnings = [];
  const fmtGbp = (v) => '£' + Math.round(Number(v) || 0).toLocaleString('en-GB');
  if (netModel && netValue !== null && netValue <= 0) warnings.push('Property value is zero or less - no loan can be offered on it.');
  // Distinguish "inputs still missing" from "inputs entered but the loan works out at
  // zero or less", so the BDM is told WHAT is wrong rather than a generic 'enter the
  // figures' hint (client 05-10-2026: a 2nd charge where the 1st charge exceeds the
  // Max LTV must explain itself, not show a blank summary).
  const missingInputs = ltvMode === 'amount'
    ? (propertyValue === null || override === null)
    : (propertyValue === null || ltvPct === null);
  if (missingInputs) {
    warnings.push(ltvMode === 'amount'
      ? 'Enter a property value + loan amount to produce the indicative terms.'
      : 'Enter a property value + LTV % (or switch LTV to £ and type the loan amount) to produce the indicative terms.');
  } else if (!ready) {
    if (!equityModel && maxLtv !== null && firstCharge !== null && firstCharge > 0 && maxLtv <= firstCharge) {
      warnings.push(`No loan available on a 2nd charge: the Max LTV (${fmtGbp(maxLtv)}) does not cover the 1st charge (${fmtGbp(firstCharge)}). Lower the 1st charge, or raise the LTV % / property value.`);
    } else if (equityModel && equity !== null && equity <= 0 && firstCharge) {
      warnings.push(`No equity to lend against: outstanding loans / charges (${fmtGbp(firstCharge)}) use up the property value (${fmtGbp(propertyValue)}). Lower the charges, or raise the property value.`);
    } else if (base !== null && base <= 0) {
      warnings.push('The loan works out at zero or less with these figures — check the LTV %, property value and 1st charge.');
    } else {
      warnings.push('These figures do not produce a valid loan — check the LTV %, property value and 1st charge.');
    }
  }
  if (ready && day1Net !== null && day1Net < 0) warnings.push('Day 1 net release is negative — deductions exceed the available advance.');
  warnings.push(...ddWarnings);
  if (termMonths !== null && termMonths < MIN_TERM_MONTHS) warnings.push(`Term ${termMonths}m is below the minimum ${MIN_TERM_MONTHS}m`);

  return {
    inputs: {
      gdv, ltv_pct: ltvPct, term_months: termMonths,
      monthly_rate_pct: monthlyRate, gross_loan: override,
      arrangement_fee_pct: arrangementVal, arrangement_fee_is_pct: arrangementIsPct,
      broker_fee: brokerVal, broker_fee_is_pct: brokerIsPct, document_fee: documentFee,
      interest_type: interestType, drawdowns, calc_type: calcType, annual_rate_pct: annualRate,
      ltv_mode: ltvMode,
      // Echo inputs as typed (main value / main 1st charge, not the totals).
      property_value: netModel ? netValue : mainValue, first_charge: mainCharge,
      additional_securities: addSecs,
      value_model: netModel ? 'net' : null,
      security_value: netModel ? propertyValue : null,
      charges_total: netModel ? netCharges : null,
      main_security_value: netModel ? mainValue : null,
      main_charges: netModel ? mainCharge : null,
    },
    calc: {
      ready,
      interest_type: interestType,
      calc_type: calcType,
      ltv_mode: ltvMode,
      value_model: netModel ? 'net' : null,
      // NET model: the value the LTV % is taken of (securities less outstanding loans / 2nd charges).
      net_property_value: netModel ? netValue : null,
      // For Serviced, expose the DERIVED annual rate (monthly*16 - 2.4) so the popup/PDF show
      // it even when the request did not carry an explicit annual_rate_pct (client 02-10-2026).
      annual_rate_pct: interestType === 'Serviced' ? servicedAnnual : annualRate,
      monthly_interest: monthlyInterest,
      property_value: propertyValue,
      // Security breakdown: main property + the additional securities that were ticked.
      main_property_value: mainValue,
      main_first_charge: mainCharge,
      additional_securities: addIncluded,
      additional_securities_value: addValue,
      additional_securities_charges: addCharges,
      total_security_value: propertyValue,
      ltv_pct: impliedLtvPct,
      gdv,
      ltgdv_pct: ltgdvPct,
      first_charge: firstCharge,
      max_ltv: maxLtv,
      base_gross: base,
      total_gross_loan_incl_dds: totalGrossInclDDs,
      arrangement_fee: arrangementFee,
      arrangement_fee_is_pct: arrangementIsPct,
      arrangement_fee_pct: arrangementIsPct ? arrangementVal : null,
      broker_fee: brokerFee,
      broker_fee_is_pct: brokerIsPct,
      broker_fee_pct: brokerIsPct ? brokerVal : null,
      document_fee: documentFee,
      retained_interest_day1_rate_pct: monthlyRate,
      retained_interest_day1: retainedDay1,
      drawdown_retained_interest: drawdownRetained,
      retained_interest_total: retainedTotal,
      day1_total_deductions: day1TotalDeductions,
      day1_net: day1Net,
      total_deductions: day1TotalDeductions,
      total_net: day1Net,
      drawdowns_total: drawdownsSum,
      drawdowns_net_total: drawdownNetSum,
      total_net_incl_drawdowns: totalNetInclDrawdowns,
      actual_total_ltv_pct: actualTotalLtvPct,
      monthly_payment: monthlyPayment,
      serviced_interest_total: servicedInterestTotal,
      term_months: termMonths,
      drawdowns: drawdownRows,
    },
    warnings,
  };
}

module.exports = { computeIndicative };
