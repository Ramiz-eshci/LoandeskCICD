'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
jest.mock('../../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn() }));
jest.mock('../../../services/mail.service', () => ({ sendMail: jest.fn() }));
jest.mock('../../../services/emailHub.service', () => ({ render: jest.fn(() => ({ subject: '', html: '' })) }));
jest.mock('../../../services/pdf/redemption-pdf.service', () => ({ buildRedemptionStatementPdf: jest.fn(), longDate: (d) => d }));

const db = require('../../../config/database');
const fp = require('../../../services/facilityPosition.service');
const redemption = require('../../../services/redemption.service');

// Drawdown facility: £1,000,000 gross incl. 2 agreed tranches, 1% pm.
const LOAN = {
  loan_id: 1, status: 'Active', principal: 1000000, rate_pct: 1, term_months: 12,
  start_date: '2026-01-01', maturity_date: '2026-12-31', net_advance: 700000,
  agreed_terms: JSON.stringify({
    net_release_day1: 700000, net_release_incl_drawdowns: 880000,
    drawdowns: [{ month: 3, gross: 100000, net: 95000 }, { month: 6, gross: 100000, net: 85000 }],
  }),
};
const DD1 = { drawn_on: '2026-04-01', amount: 100000, status: 'Released', agreed_month: 3 };
const DD2 = { drawn_on: '2026-07-01', amount: 100000, status: 'Released', agreed_month: 6 };

describe('facility position', () => {
  it('net loan = day 1 net + every released drawdown net', () => {
    expect(fp.position(LOAN, [], []).netLoan).toBe(700000);
    expect(fp.position(LOAN, [DD1], []).netLoan).toBe(795000);
    expect(fp.position(LOAN, [DD1, DD2], []).netLoan).toBe(880000);
    // a Scheduled (not sent) tranche does not count
    expect(fp.position(LOAN, [{ ...DD2, status: 'Scheduled' }], []).netLoan).toBe(700000);
  });

  it('legacy net_advance holding the total incl. drawdowns is read as day 1', () => {
    expect(fp.position({ ...LOAN, net_advance: 880000 }, [DD1], []).day1Net).toBe(700000);
  });

  it('outstanding = net loan - payments recorded, never below zero', () => {
    const p = fp.position(LOAN, [DD1, DD2], [{ paid_on: '2026-08-01', amount: 80000 }]);
    expect(p.outstanding).toBe(800000);
    expect(p.monthlyInterest).toBe(8000);
    expect(fp.position(LOAN, [], [{ paid_on: '2026-02-01', amount: 900000 }]).outstanding).toBe(0);
  });

  it('daily accrual follows the running balance (drawdowns in, payments out)', () => {
    const p = fp.position(LOAN, [DD1], [{ paid_on: '2026-05-01', amount: 95000 }]);
    // 700k Jan1-Apr1 (90d), 795k Apr1-May1 (30d), 700k May1-May31 (30d)
    const exp = (700000 * 90 + 795000 * 30 + 700000 * 30) * 0.01 * 12 / 365;
    expect(fp.accrued(p, '2026-05-31', 'daily').amount).toBeCloseTo(exp, 1);
  });

  it('exit fee rules', () => {
    const p = fp.position(LOAN, [DD1, DD2], []);
    expect(fp.exitFee(p, null, null, []).amount).toBe(8800);          // 1 month on 880k
    expect(fp.exitFee(p, 'months', 2, []).amount).toBe(17600);
    expect(fp.exitFee(p, 'amount', 5000, []).amount).toBe(5000);
    expect(fp.exitFee(p, 'pct_gross', 1, []).amount).toBe(10000);    // 1% of 1m drawn
    expect(fp.exitFee(p, 'pct_net', 1, []).amount).toBe(8800);
    expect(fp.exitFee(p, null, null, [{ fee_type: 'Exit', amount: 1234, status: 'Due' }]).amount).toBe(1234);
  });
});

describe('redemption figures', () => {
  const ledger = (dds, pays) => ({ drawdowns: dds, payments: pays, fees: [] });
  beforeEach(() => db.query.mockResolvedValue([]));

  it('early redemption pays the minimum interest; total = principal + interest + fees + exit', async () => {
    const f = await redemption.figures({ ...LOAN, min_interest_months: 3 }, {
      redemption_date: '2026-02-01', document_fee: 1000, broker_fee: 2000, arrangement_fee: 3000, _ledger: ledger([], []),
    });
    // Client 27-10-2026: Outstanding Principal = GROSS - payments (as the header), interest on the net.
    expect(f.principal_amount).toBe(1000000);
    expect(f.monthly_interest).toBe(7000);
    expect(f.min_interest).toBe(21000);
    expect(f.min_interest_applies).toBe(true);
    expect(f.accrued_interest + f.min_interest_adj).toBeCloseTo(21000, 2);
    expect(f.other_fees).toBe(6000);
    expect(f.exit_fee).toBe(7000);
    expect(f.total_amount).toBeCloseTo(1000000 + 21000 + 6000 + 7000, 2);
  });

  it('document / broker / arrangement fees start at 0 (already inside the gross)', async () => {
    const f = await redemption.figures({ ...LOAN, enquiry_id: 9 }, { redemption_date: '2026-06-01', _ledger: ledger([], []) });
    expect([f.document_fee, f.broker_fee, f.arrangement_fee, f.other_fees]).toEqual([0, 0, 0, 0]);
    const g = await redemption.figures({ ...LOAN }, {
      redemption_date: '2026-06-01', _ledger: { drawdowns: [], payments: [], fees: [{ fee_type: 'Broker', amount: 500, status: 'Due' }] },
    });
    expect(g.broker_fee).toBe(500);
  });

  it('after the minimum period no top-up; partial payment lowers principal + interest', async () => {
    const f = await redemption.figures({ ...LOAN, min_interest_months: 3 }, {
      redemption_date: '2026-09-01', document_fee: 0, broker_fee: 0, arrangement_fee: 0,
      _ledger: ledger([DD1, DD2], [{ paid_on: '2026-08-01', amount: 80000 }]),
    });
    expect(f.min_interest_applies).toBe(false);
    expect(f.min_interest_adj).toBe(0);
    expect(f.net_principal).toBe(880000);
    expect(f.amount_paid).toBe(80000);
    expect(f.principal_amount).toBe(920000);
    expect(f.exit_fee).toBe(8000);
    expect(f.total_amount).toBeCloseTo(920000 + f.accrued_interest + 8000, 2);
  });

  it('calculating a redemption never writes to the facility', async () => {
    db.query.mockClear();
    await redemption.figures({ ...LOAN }, { redemption_date: '2026-06-01', _ledger: ledger([DD1], []) });
    const writes = db.query.mock.calls.filter(([sql]) => /(UPDATE|INSERT INTO|DELETE FROM)/i.test(sql));
    expect(writes).toHaveLength(0);
  });

  // Client 27-10-2026: after Redeem Facility the calculator shows the header's Amount
  // Outstanding (fixed amount - payments) with no further interest / fees.
  it('a fixed (Completed) redemption: Outstanding = fixed amount less payments, nothing added', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/status='Completed'/.test(sql)) return [{ redemption_id: 13, total_amount: 982709.6 }];
      if (/SELECT figures_json/.test(sql)) return [{ figures_json: JSON.stringify({ total_amount: 982709.6, amount_paid: 0 }) }];
      return [];
    });
    const f = await redemption.figures({ ...LOAN, status: 'Active' }, {
      redemption_date: '2026-10-26', _ledger: ledger([], [{ paid_on: '2026-10-01', amount: 2709.6 }]),
    });
    expect(f.fixed_redemption_id).toBe(13);
    expect(f.principal_amount).toBe(980000);
    expect([f.accrued_interest, f.other_fees, f.exit_fee]).toEqual([0, 0, 0]);
    expect(f.total_amount).toBe(980000);
  });
});
