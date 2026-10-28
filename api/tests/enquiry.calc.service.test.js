'use strict';

/**
 * Locks the indicative calculation to the client's "Calc with DDs.xlsx"
 * (Southgate, 17-09-2026). If any assertion fails, someone changed the money
 * maths — find out why before shipping.
 *
 * Feeder Info inputs: Value 126,000 · LTV 75% · Rate 1.15% · Term 12 ·
 * Arrangement 2% · Introducer 1% · Document £1,000 · GDV 210,000 ·
 * Drawdown 1 = £17,172 at month 1.
 */

const { computeIndicative } = require('../services/enquiry.calc.service');

const DDS_SHEET = {
  interest_type: 'Retained',
  property_value: 126000,
  ltv_pct: 75,
  monthly_rate_pct: 1.15,
  term_months: 12,
  arrangement_fee_pct: 2,
  arrangement_fee_is_pct: true,
  broker_fee: 1,
  broker_fee_is_pct: true,
  document_fee: 1000,
  gdv: 210000,
  drawdowns: [
    { amount: 17172, month: 1 },
    { amount: null, month: 2 },
    { amount: null, month: 3 },
    { amount: null, month: 4 },
  ],
};

describe('computeIndicative — Calc with DDs.xlsx reconciliation', () => {
  const { calc } = computeIndicative(DDS_SHEET);

  it('is ready', () => expect(calc.ready).toBe(true));
  it('Max LTV = value x LTV (E9)', () => expect(calc.max_ltv).toBe(94500));
  it('Total Gross Loan incl DDs = Max LTV + drawdown gross (E11)', () => expect(calc.total_gross_loan_incl_dds).toBe(111672));
  it('LTGDV = total gross / GDV (E7)', () => expect(calc.ltgdv_pct).toBeCloseTo(53.18, 2));
  it('Arrangement fee = 2% of total gross incl DDs (E13)', () => expect(calc.arrangement_fee).toBeCloseTo(2233.44, 2));
  it('Broker fee = 1% of total gross incl DDs (E15)', () => expect(calc.broker_fee).toBeCloseTo(1116.72, 2));
  it('Retained interest day 1 = Max LTV x rate x term (E19)', () => expect(calc.retained_interest_day1).toBeCloseTo(13041, 2));
  it('Drawdown 1 interest = gross x (term - month) x rate (Feeder E21)', () => {
    expect(calc.drawdowns[0].months_left).toBe(11);
    expect(calc.drawdowns[0].interest).toBeCloseTo(2172.26, 2);
  });
  it('Drawdown 1 net (E26)', () => expect(calc.drawdowns[0].net).toBeCloseTo(14999.74, 2));
  it('Retained interest total (E20)', () => expect(calc.retained_interest_total).toBeCloseTo(15213.26, 2));
  it('Day 1 total deductions (E22)', () => expect(calc.day1_total_deductions).toBeCloseTo(17391.16, 2));
  it('Day 1 net = Max LTV - deductions (E24)', () => expect(calc.day1_net).toBeCloseTo(77108.84, 2));
  it('Total net incl drawdowns (E31)', () => expect(calc.total_net_incl_drawdowns).toBeCloseTo(92108.58, 2));
  it('empty drawdown rows are ignored', () => expect(calc.drawdowns.length).toBe(1));
});

describe('computeIndicative — no defaults', () => {
  it('an empty form produces blanks, never house figures', () => {
    const { calc } = computeIndicative({});
    expect(calc.ready).toBe(false);
    for (const k of ['max_ltv', 'arrangement_fee', 'broker_fee', 'document_fee',
      'retained_interest_day1', 'day1_net', 'ltgdv_pct', 'ltv_pct']) {
      expect(calc[k]).toBeNull();
    }
  });

  it('does not invent a monthly rate', () => {
    const { calc } = computeIndicative({ ...DDS_SHEET, monthly_rate_pct: '' });
    expect(calc.retained_interest_day1).toBeNull();
  });
});

/* ---- The other three client workbooks (Calc with DDs above is unchanged) ---- */
const base3 = { arrangement_fee_is_pct: true, broker_fee_is_pct: true };

describe('computeIndicative — Bridge Calc Current.xlsx (Baltic Road x 2)', () => {
  const { calc } = computeIndicative({ ...base3, calc_type: 'bridge', interest_type: 'Retained',
    property_value: 1450000, ltv_pct: 70, monthly_rate_pct: 1.05, term_months: 12,
    arrangement_fee_pct: 2, broker_fee: 1, document_fee: 2000 });
  it('total gross loan (E14)', () => expect(calc.base_gross).toBe(1015000));
  it('monthly rate £ (E16)', () => expect(calc.monthly_interest).toBeCloseTo(10657.5, 2));
  it('arrangement fee (E18)', () => expect(calc.arrangement_fee).toBeCloseTo(20300, 2));
  it('broker fee (E20)', () => expect(calc.broker_fee).toBeCloseTo(10150, 2));
  it('retained interest 12 months (E24)', () => expect(calc.retained_interest_day1).toBeCloseTo(127890, 2));
  it('total deductions (E26)', () => expect(calc.day1_total_deductions).toBeCloseTo(160340, 2));
  it('total net (E28)', () => expect(calc.day1_net).toBeCloseTo(854660, 2));
});

describe('computeIndicative — 2nd CB Calc Current.xlsx (Lansdowne)', () => {
  const { calc } = computeIndicative({ ...base3, calc_type: 'second_charge', interest_type: 'Retained',
    property_value: 450000, ltv_pct: 50.05, first_charge: 70000, monthly_rate_pct: 1.05, term_months: 12,
    arrangement_fee_pct: 2, broker_fee: 1, document_fee: 1000 });
  it('max LTV (E12)', () => expect(calc.max_ltv).toBeCloseTo(225225, 2));
  it('gross loan = max LTV - 1st charge (E15)', () => expect(calc.base_gross).toBeCloseTo(155225, 2));
  it('monthly rate £ (E17)', () => expect(calc.monthly_interest).toBeCloseTo(1629.86, 2));
  it('arrangement fee (E19)', () => expect(calc.arrangement_fee).toBeCloseTo(3104.5, 2));
  it('broker fee (E21)', () => expect(calc.broker_fee).toBeCloseTo(1552.25, 2));
  it('retained interest months (E25)', () => expect(calc.retained_interest_day1).toBeCloseTo(19558.35, 2));
  it('total deductions (E27)', () => expect(calc.day1_total_deductions).toBeCloseTo(25215.1, 2));
  it('total net (E29)', () => expect(calc.day1_net).toBeCloseTo(130009.9, 2));
});

describe('computeIndicative — Calc monthly serviced.xlsx (Leitrim)', () => {
  const { calc } = computeIndicative({ ...base3, calc_type: 'serviced', interest_type: 'Serviced',
    property_value: 1750000, ltv_pct: 70, monthly_rate_pct: 1.05, annual_rate_pct: 14.4, term_months: 12,
    arrangement_fee_pct: 2, broker_fee: 1, document_fee: 1000 });
  it('total gross loan (E7)', () => expect(calc.base_gross).toBe(1225000));
  it('arrangement fee (E9)', () => expect(calc.arrangement_fee).toBeCloseTo(24500, 2));
  it('broker fee (E11)', () => expect(calc.broker_fee).toBeCloseTo(12250, 2));
  it('total deductions — no interest deducted (E17)', () => expect(calc.day1_total_deductions).toBeCloseTo(37750, 2));
  it('total net (E19)', () => expect(calc.day1_net).toBeCloseTo(1187250, 2));
  it('monthly interest = gross x 14.4% / 12 (E21)', () => expect(calc.monthly_payment).toBeCloseTo(14700, 2));
});

describe('computeIndicative — drawdowns typed as NET (client point #2)', () => {
  const netInputs = { ...DDS_SHEET, drawdowns: [{ net: 14999.74, month: 1 }, { net: null, month: 2 }] };
  const { calc } = computeIndicative(netInputs);
  const legacy = computeIndicative(DDS_SHEET).calc;

  it('keeps the typed net to the penny', () => expect(calc.drawdowns[0].net).toBe(14999.74));
  it('back-solves the sheet gross (E20) within a penny', () => expect(Math.abs(calc.drawdowns[0].amount - 17172)).toBeLessThanOrEqual(0.01));
  it('interest = gross - net', () => expect(calc.drawdowns[0].interest).toBeCloseTo(calc.drawdowns[0].amount - 14999.74, 2));
  it('totals match the gross-typed sheet within a penny', () => {
    expect(Math.abs(calc.total_gross_loan_incl_dds - legacy.total_gross_loan_incl_dds)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(calc.total_net_incl_drawdowns - legacy.total_net_incl_drawdowns)).toBeLessThanOrEqual(0.02);
  });
  it('serviced: gross = net (no retained interest)', () => {
    const r = computeIndicative({ ...netInputs, interest_type: 'Serviced' }).calc;
    expect(r.drawdowns[0].amount).toBe(14999.74);
  });
  it('warns and skips a drawdown whose interest would eat it all', () => {
    const r = computeIndicative({ ...netInputs, monthly_rate_pct: 10, term_months: 12, drawdowns: [{ net: 1000, month: 1 }] });
    expect(r.calc.drawdowns.length).toBe(0);
    expect(r.warnings.some((w) => w.startsWith('Drawdown 1'))).toBe(true);
  });
});

describe('computeIndicative — other / additional securities (client point #5)', () => {
  const base = { property_value: 200000, ltv_pct: 70, monthly_rate_pct: 1, term_months: 12, calc_type: 'bridge' };
  it('no additional securities: unchanged', () => {
    const { calc } = computeIndicative(base);
    expect(calc.max_ltv).toBe(140000);
    expect(calc.base_gross).toBe(140000);
  });
  it('adds ticked security values and their existing charges (equity model, client 28-09-2026)', () => {
    // Equity model: Max LTV = (security value - existing charges) x LTV%.
    //   security value 300,000 - 20,000 charge = 280,000 equity; 280,000 x 70% = 196,000.
    const { calc } = computeIndicative({ ...base, additional_securities: [
      { address: '2 High St', estimated_value: '100,000', existing_charge: '20000' },
      { address: '3 Low St', estimated_value: 50000, include: false },
    ] });
    expect(calc.total_security_value).toBe(300000);
    expect(calc.max_ltv).toBe(196000);
    expect(calc.first_charge).toBe(20000);
    expect(calc.base_gross).toBe(196000);
    expect(calc.additional_securities.length).toBe(1);
  });
  it('amount mode back-solves LTV on the equity after existing charges (client 28-09-2026)', () => {
    // 130,000 loan / (300,000 - 20,000 equity) = 46.43%.
    const { calc } = computeIndicative({ ...base, ltv_mode: 'amount', gross_loan: 130000,
      additional_securities: [{ value: 100000, existing_charge: 20000 }] });
    expect(calc.ltv_pct).toBe(46.43);
  });
  it('inputs echo the main value, not the total', () => {
    const { inputs } = computeIndicative({ ...base, additional_securities: [{ value: 100000 }] });
    expect(inputs.property_value).toBe(200000);
  });
});
