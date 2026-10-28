'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));

const db = require('../../../config/database');
const analytics = require('../../../services/reports.analytics.service');
const { drawdownTerms } = require('../../../services/pdf/deal-summary-pdf.service');

const d = (s) => new Date(s);
const ENQ = [
  { enquiry_id: 1, created_at: d('2026-03-02'), status_code: 'CONVERTED', status_name: 'Converted', is_terminal: true, status_sort: 9, amount: 300000, bdm: 'A', source: 'Broker', product: 'Bridging', indicative_sent: 1, offer_sent: 1, application_id: 10, app_created_at: d('2026-03-20'), app_status_code: 'COMPLETED', uw_status: 'In Portfolio', loan_id: 100, loan_status: 'Active', loan_start: d('2026-04-15'), loan_principal: 300000 },
  { enquiry_id: 2, created_at: d('2026-05-02'), status_code: 'LOST', status_name: 'Declined', is_terminal: true, status_sort: 10, amount: 1500000, bdm: 'B', source: 'Direct', product: 'Dev', indicative_sent: 1, offer_sent: 0 },
  { enquiry_id: 3, created_at: d('2026-09-02'), status_code: 'NEW', status_name: 'New', is_terminal: false, status_sort: 1, amount: 100000, bdm: 'A', source: 'Broker', product: 'Bridging', indicative_sent: 0, offer_sent: 0 },
];
const LOANS = [
  { loan_id: 100, loan_number: 'L1', principal: 400000, rate_pct: 0.85, term_months: 12, start_date: d('2026-04-15'), maturity_date: d('2027-04-14'), status: 'Active', outstanding_balance: 300000, net_advance: 280000, agreed_terms: JSON.stringify({ arrangement_fee: 8000, drawdowns: [{ month: 3, gross: 50000, net: 47000 }, { month: 8, gross: 50000, net: 46000 }] }), product: 'Bridging', bdm: 'A' },
];

beforeEach(() => {
  db.queryNamed.mockImplementation(async (sql) => {
    if (sql.includes('FROM enquiry_declines')) return [{ enquiry_id: 2, previous_status_code: 'INDICATIVE_SENT', reason_name: 'Loan Size' }];
    if (sql.includes('FROM enquiries e')) return ENQ;
    if (sql.includes('FROM loans l')) return LOANS;
    if (sql.includes('FROM loan_drawdowns')) return [{ loan_id: 100, drawn_on: d('2026-07-15'), amount: 50000, status: 'Released', agreed_month: 3 }];
    return [];
  });
});

describe('reports.analytics', () => {
  it('bands loan sizes', () => {
    const { band } = analytics._internal;
    expect(band(100000).key).toBe('small');
    expect(band(250000).key).toBe('medium');
    expect(band(1000000).key).toBe('large');
  });

  it('names merged underwriting steps like the case screen (no "Step 12")', () => {
    const { uwStage } = analytics._internal;
    expect(uwStage(12).label).toBe('Completion & Move to Portfolio');
    expect(uwStage(8).label).toBe('Underwriting Review');
  });

  it('enquiry report offers number / value / size views on the BDM chart', async () => {
    const rep = await analytics.enquiryReport({ from: '2026-01-01', to: null, status: null, bdm: null });
    const bdm = rep.charts.find((c) => c.id === 'bdm');
    expect(bdm.views.map((v) => v.key)).toEqual(['count', 'value', 'band_count', 'band_value']);
    const val = bdm.views.find((v) => v.key === 'value').data.groups.find((g) => g.label === 'B');
    expect(val.values[2]).toBe(1500000); // Declined value
  });

  it('enquiry report has a bar chart of declined deals by reason (client 26-10-2026)', async () => {
    const closed = { enquiry_id: 4, created_at: d('2026-06-02'), status_code: 'CLOSED', status_name: 'Closed', is_terminal: true, status_sort: 11, amount: 200000, bdm: 'A', source: 'Broker', product: 'Bridging' };
    const rows = [...ENQ, closed];
    db.queryNamed.mockImplementation(async (sql) => {
      if (sql.includes('FROM enquiry_declines')) {
        return [
          { enquiry_id: 2, previous_status_code: 'INDICATIVE_SENT', reason_name: 'Loan Size' },
          { enquiry_id: 2, previous_status_code: 'INDICATIVE_SENT', reason_name: 'Asset Type' },
        ];
      }
      if (sql.includes('FROM enquiries e')) return rows;
      return [];
    });
    const rep = await analytics.enquiryReport({ from: '2026-01-01', to: null, status: null, bdm: null });
    const ch = rep.charts.find((c) => c.id === 'declines');
    expect(ch.title).toBe('Declined Deals by Reason');
    expect(ch.type).toBe('bar');
    expect(ch.drill).toBe('decline_reason');
    expect(ch.views.map((v) => v.key)).toEqual(['count', 'value']);
    const bars = (v) => Object.fromEntries(v.data.groups.map((g) => [g.label, g.values[0]]));
    expect(bars(ch.views[0])).toEqual({ 'Loan Size': 1, 'Asset Type': 1, 'No reason recorded': 1 });
    expect(bars(ch.views[1])).toEqual({ 'Loan Size': 1500000, 'Asset Type': 1500000, 'No reason recorded': 200000 });
    // Drill field: declined rows carry their reasons, live / converted rows none.
    const detail = (id) => rep.detail.rows[rows.findIndex((r) => r.enquiry_id === id)];
    expect(detail(2).decline_reason).toEqual(['Loan Size', 'Asset Type']);
    expect(detail(4).decline_reason).toEqual(['No reason recorded']);
    expect(detail(1).decline_reason).toBeUndefined();
  });

  it('summary report builds a balanced Sankey flow', async () => {
    const rep = await analytics.summaryReport({ from: null, to: null, status: null, bdm: null });
    const sk = rep.charts.find((c) => c.id === 'pipeline').views[0].data;
    const fromEnq = sk.links.filter((l) => l.source === 'Enquiries').reduce((a, l) => a + l.value, 0);
    expect(fromEnq).toBe(3);
    expect(sk.links).toEqual(expect.arrayContaining([{ source: 'Enquiries', target: 'Declined', value: 1 }]));
  });

  it('portfolio splits interest into Retained vs Serviced + a Serviced box (client 26-10-2026)', async () => {
    const { modelLoan } = analytics._internal;
    // Interest type: agreed terms win, then the enquiry's type, else Serviced.
    expect(modelLoan({ ...LOANS[0], agreed_terms: JSON.stringify({ interest_type: 'Retained' }) }, [], [], [], []).interestType).toBe('Retained');
    expect(modelLoan({ ...LOANS[0], agreed_terms: '{}', enq_interest_type: 'Retained' }, [], [], [], []).interestType).toBe('Retained');
    expect(modelLoan({ ...LOANS[0], agreed_terms: '{}', enq_interest_type: null }, [], [], [], []).interestType).toBe('Serviced');

    // Two otherwise identical loans (no drawdowns), one of each type.
    const serviced = { ...LOANS[0], agreed_terms: '{}' };
    const retained = { ...LOANS[0], loan_id: 101, loan_number: 'L2', agreed_terms: JSON.stringify({ interest_type: 'Retained' }) };
    db.queryNamed.mockImplementation(async (sql) => (sql.includes('FROM loans l') ? [serviced, retained] : []));
    const rep = await analytics.portfolioReport({ from: null, to: null, status: null, bdm: null });
    const ch = rep.charts.find((c) => c.id === 'interest');
    // Client 27-10-2026: one tab per type, each with the amount + the facility count.
    expect(ch.views.map((v) => v.label)).toEqual(['Serviced', 'Retained']);
    const [sv, rt] = ch.views.map((v) => v.data.series);
    expect(sv.map((s) => s.name)).toEqual(['Serviced Interest', 'Facilities']);
    expect(rt.map((s) => s.name)).toEqual(['Retained Interest', 'Facilities']);
    expect(sv[1]).toMatchObject({ axis: 'right', format: 'number' });
    // Same two loans, same terms -> equal amounts, one facility each on the latest month.
    const last = sv[0].values.length - 1;
    expect(sv[0].values[last]).toBeGreaterThan(0);
    expect(sv[0].values[last]).toBe(rt[0].values[last]);
    expect(sv[1].values[last]).toBe(1);
    expect(rt[1].values[last]).toBe(1);
    const kpis = rep.kpis.map((k) => k.label);
    expect(kpis.indexOf('Serviced Interest This Month')).toBe(kpis.indexOf('Interest This Month') + 1);
    const box = rep.kpis.find((k) => k.label === 'Serviced Interest This Month');
    expect(box.caption).toBe('1 serviced facility');
    expect(box.value).toBeCloseTo(rep.kpis.find((k) => k.label === 'Interest This Month').value / 2, 1);
  });

  it('summary Loan Book Movement waterfall: opening, + new, - redeemed, month-end totals (client 26-10-2026)', () => {
    const { bookMovementChart, monthAxis } = analytics._internal;
    const axis = monthAxis({ from: '2026-07-01', to: '2026-08-31' });
    const book = [
      { start: d('2026-05-10'), principal: 500000 },                                    // opening
      { start: d('2026-07-05'), principal: 200000 },                                    // new in Jul
      { start: d('2026-06-01'), principal: 100000, redeemedOn: d('2026-08-15') },       // redeemed in Aug
      { start: d('2026-08-03'), principal: 50000 },                                     // new in Aug
    ];
    const items = bookMovementChart(axis, book).data.items;
    expect(items.map((i) => [i.label, i.kind, i.value])).toEqual([
      ['Opening Jul', 'total', 600000],
      ['Jul · New', 'up', 200000],
      ['Jul End', 'total', 800000],
      ['Aug · New', 'up', 50000],
      ['Aug · Redeemed', 'down', 100000],
      ['Aug End', 'total', 750000],
    ]);
  });

  it('portfolio Redemptions & Extensions per month (client 26-10-2026)', async () => {
    const redeemed = { ...LOANS[0], status: 'Redeemed' };
    db.queryNamed.mockImplementation(async (sql) => {
      if (sql.includes('FROM loans l')) return [redeemed];
      if (sql.includes('FROM loan_redemptions')) return [{ loan_id: 100, redemption_date: d('2026-09-10'), principal_amount: 290000, exit_fee: 0 }];
      if (sql.includes('FROM portfolio_extensions')) return [{ extension_id: 1, loan_id: 100, extended_on: d('2026-08-20'), amount: 300000 }, { extension_id: 2, loan_id: 999, extended_on: d('2026-08-21'), amount: 1 }];
      return [];
    });
    const rep = await analytics.portfolioReport({ from: '2026-08-01', to: '2026-09-30', status: null, bdm: null });
    const ch = rep.charts.find((c) => c.id === 'redemptions');
    expect(ch.views.map((v) => v.key)).toEqual(['count', 'value']);
    const vals = (k) => Object.fromEntries(ch.views.find((v) => v.key === k).data.groups.map((g) => [g.label, g.values]));
    expect(ch.views[0].data.seriesNames).toEqual(['Redemptions', 'Extensions']);
    expect(vals('count')).toEqual({ Aug: [0, 1], Sept: [1, 0] }); // the extension on an unknown loan is ignored
    expect(vals('value')).toEqual({ Aug: [0, 300000], Sept: [290000, 0] });
  });

  it('summary Business Mix averages amount / rate / term per start month, gaps as null (client 26-10-2026)', () => {
    const { businessMixChart, monthAxis } = analytics._internal;
    const axis = monthAxis({ from: '2026-07-01', to: '2026-09-30' });
    const book = [
      { start: d('2026-07-10'), principal: 200000, rate: 0.8, termMonths: 12 },
      { start: d('2026-07-20'), principal: 400000, rate: 1.0, termMonths: 18 },
      { start: d('2026-09-05'), principal: 150000, rate: 0.9, termMonths: 9 },
    ];
    const ch = businessMixChart(axis, book);
    expect(ch.title).toBe('Business Mix per Month');
    expect(ch.views.map((v) => v.key)).toEqual(['amount', 'rate', 'term']);
    const vals = (k) => ch.views.find((v) => v.key === k).data.series[0].values;
    expect(ch.views[0].data.keys).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(vals('amount')).toEqual([300000, null, 150000]);
    expect(vals('rate')).toEqual([0.9, null, 0.9]);
    expect(vals('term')).toEqual([15, null, 9]);
  });

  it('summary Average Time Taken breaks down by deal type / valuation / rep (client 26-10-2026)', async () => {
    const val = (types) => JSON.stringify({ fields: { entries: types.map((t) => ({ valuation_type: t })) } });
    const rows = [
      // 18 days to application, 44 more to completion
      { ...ENQ[0], deal_type: 'Residential', rep_type: 'dual', uw_valuation_data: val(['AVM']) },
      // application only, 10 days; two valuations -> counted under both
      { enquiry_id: 5, created_at: d('2026-06-01'), status_code: 'CONVERTED', amount: 100000, bdm: 'A', application_id: 11, app_created_at: d('2026-06-11'), deal_type: 'Commercial', rep_type: null, uw_valuation_data: val(['AVM', 'Desktop']) },
      // never got to an application -> not measured, so no series
      { ...ENQ[2], deal_type: null, rep_type: 'single', uw_valuation_data: null },
    ];
    db.queryNamed.mockImplementation(async (sql) => (sql.includes('FROM enquiries e') ? rows : []));
    const rep = await analytics.summaryReport({ from: null, to: null, status: null, bdm: null });
    const ch = rep.charts.find((c) => c.id === 'durations');
    expect(ch.views.map((v) => v.key)).toEqual(['all', 'deal_type', 'valuation', 'rep']);
    expect(ch.views[0].type).toBe('barlist');
    const view = (k) => ch.views.find((v) => v.key === k).data;
    const deal = view('deal_type');
    expect(deal.seriesNames).toEqual(['Residential (1)', 'Commercial (1)']);
    expect(deal.groups.map((g) => g.label)).toEqual(['Enquiry → Application', 'Application → Completion', 'Enquiry → Completion']);
    expect(deal.groups[0].values).toEqual([18, 10]);
    expect(deal.groups[1].values).toEqual([26, 0]);
    expect(view('valuation').seriesNames).toEqual(['AVM (2)', 'Desktop (1)']);
    expect(view('valuation').groups[0].values).toEqual([14, 10]); // AVM avg of 18 and 10
    expect(view('rep').seriesNames).toEqual(['Dual (1)', 'Not set (1)']);
  });

  it('finance report accrues interest on the drawn balance', async () => {
    const { modelLoan, interestInMonth } = analytics._internal;
    const L = modelLoan(LOANS[0], [], [{ drawn_on: d('2026-07-15'), amount: 50000, status: 'Released', agreed_month: 3 }], [], []);
    expect(L.day1Gross).toBe(300000);
    // May 2026: only day-1 gross drawn -> 300,000 x 0.85%
    expect(Math.round(interestInMonth(L, new Date(Date.UTC(2026, 4, 1))))).toBe(2550);
    const rep = await analytics.financeReport({ from: '2026-01-01', to: null, status: null, bdm: null });
    expect(rep.kpis[0].label).toBe('Interest This Month');
    expect(rep.charts.map((c) => c.id)).toEqual(expect.arrayContaining(['income', 'cashflow', 'forecast']));
  });
});

describe('credit paper drawdown LTVs', () => {
  it('End After Drawdown LTVs are on GDV', () => {
    const out = drawdownTerms({ gross: 500000, ltvBase: 600000, gdv: 800000, pack: { net_release_day1: 300000, drawdowns: [{ month: 3, gross: 100000, net: 95000 }] } });
    expect(out.ltv).toContain('Day 1 - Gross LTV 66.67% / Net LTV 50.00%');
    expect(out.ltv).toContain('End After Drawdown - Gross LTV 62.50% / Net LTV 49.38%');
  });

  it('falls back to the security value when there is no GDV', () => {
    const out = drawdownTerms({ gross: 500000, ltvBase: 600000, pack: { net_release_day1: 300000, drawdowns: [{ month: 3, gross: 100000, net: 95000 }] } });
    expect(out.ltv).toContain('End After Drawdown - Gross LTV 83.33%');
  });
});
