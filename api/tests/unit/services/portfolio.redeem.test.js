'use strict';

// Redeem Facility from a sent statement (client 26-10-2026): finalise the statement, record
// what is still owed as the redemption payment, close the facility as Redeemed.
jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
jest.mock('../../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn((_r, x) => x) }));
jest.mock('../../../services/notification.service', () => ({}));
jest.mock('../../../services/application.service', () => ({}));
jest.mock('../../../services/enquiry.service', () => ({}));
jest.mock('../../../services/extension.service', () => ({}));
jest.mock('../../../config/microsoftGraph.service', () => ({ getGraphClient: jest.fn() }));
jest.mock('../../../services/facilityPosition.service', () => ({
  position: jest.fn((_loan, _dd, pays) => ({ principal: 1000, paid: pays.reduce((s, p) => s + p.amount, 0) })),
}));

const mockPayments = [];
let mockLoanStatus = 'Active';
let mockStatementStatus = 'Quoted';
jest.mock('../../../services/redemption.service', () => ({
  loadLoan: jest.fn(async () => ({ loan_id: 9, status: mockLoanStatus, outstanding_balance: 1000 })),
  ledger: jest.fn(async () => ({ drawdowns: [], payments: mockPayments })),
  figures: jest.fn(async () => ({ redemption_date: '2026-10-26', principal_amount: 900, accrued_interest: 80, min_interest_adj: 0, exit_fee: 20, other_fees: 0, total_amount: 1000 })),
  fixedRedemption: (...a) => jest.requireActual('../../../services/redemption.service').fixedRedemption(...a),
}));

const db = require('../../../config/database');
const portfolio = require('../../../services/portfolio.service');

beforeEach(() => {
  mockPayments.length = 0;
  mockLoanStatus = 'Active';
  mockStatementStatus = 'Quoted';
  db.queryNamed.mockResolvedValue([{ loan_id: 9, loan_number: 'FAC-9', status: 'Active', application_id: 3 }]);
  db.query.mockReset();
  db.query.mockImplementation(async (sql, params) => {
    if (/SELECT redemption_id, status, redemption_date, total_amount FROM loan_redemptions/.test(sql)) {
      return [{ redemption_id: 5, status: mockStatementStatus, redemption_date: '2026-10-26', total_amount: 1000 }];
    }
    if (/status='Quoted'/.test(sql)) return [{ redemption_id: 5, redemption_date: '2026-10-26', interest_basis: 'daily', min_interest_months: 3, figures_json: '{}' }];
    if (/status='Completed' ORDER BY/.test(sql)) return [{ redemption_id: 5, total_amount: 1000 }];
    if (/SELECT figures_json FROM loan_redemptions/.test(sql)) return [{ figures_json: JSON.stringify({ total_amount: 1000, amount_paid: 0 }) }];
    if (/FROM application_applicants/.test(sql)) return [{ applicant_id: 42 }];
    if (/INSERT INTO loan_payments/.test(sql)) { mockPayments.push({ amount: params[3] }); return [{ id: 77 }]; }
    if (/UPDATE loans SET status='Redeemed'/.test(sql)) { mockLoanStatus = 'Redeemed'; return []; }
    return [];
  });
});

const calls = (re) => db.query.mock.calls.filter(([sql]) => re.test(sql));

describe('portfolio.redeemFromStatement', () => {
  it('finalises a Quoted statement, records the redemption payment and closes the facility', async () => {
    const out = await portfolio.redeemFromStatement('FAC-9', 5, {});
    expect(out).toMatchObject({ ok: true, id: 5, redemption_date: '2026-10-26', total_amount: 1000, payment_id: 77, payment_amount: 1000, redeemed: true });
    expect(calls(/UPDATE loan_redemptions SET status='Completed'/)).toHaveLength(1);
    const pay = calls(/INSERT INTO loan_payments/)[0][1];
    expect(pay).toEqual([9, 42, '2026-10-26', 1000, 'RS-5', null]);
    expect(calls(/UPDATE loan_redemptions SET payment_id/)[0][1]).toEqual([5, 77]);
    expect(calls(/UPDATE loans SET status='Redeemed'/)).toHaveLength(1);
    expect(calls(/UPDATE loans SET outstanding_balance=0/)).toHaveLength(1);
  });

  it('a statement already Completed by the old button goes straight to payment + close', async () => {
    mockStatementStatus = 'Completed';
    const out = await portfolio.redeemFromStatement('FAC-9', 5, {});
    expect(out.ok).toBe(true);
    expect(calls(/UPDATE loan_redemptions SET status='Completed'/)).toHaveLength(0);
    expect(out.payment_amount).toBe(1000);
    expect(calls(/UPDATE loans SET status='Redeemed'/)).toHaveLength(1);
  });

  it('refuses a facility that is not active', async () => {
    db.queryNamed.mockResolvedValue([{ loan_id: 9, loan_number: 'FAC-9', status: 'Redeemed', application_id: 3 }]);
    const out = await portfolio.redeemFromStatement('FAC-9', 5, {});
    expect(out.ok).toBe(false);
    expect(calls(/INSERT INTO loan_payments/)).toHaveLength(0);
  });
  // Client 27-10-2026: instalments follow the payments (were never marked Paid).
  it('re-marks the schedule from the payments after the redemption payment', async () => {
    await portfolio.redeemFromStatement('FAC-9', 5, {});
    const sync = calls(/UPDATE s SET status = CASE WHEN cum <= @p1/);
    expect(sync.length).toBeGreaterThan(0);
    expect(sync[sync.length - 1][1]).toEqual([9, 1000]);
  });
});

describe('portfolio Today tab', () => {
  // Client 27-10-2026: not month wise - Payment on the maturity date, Overdue after it.
  it('Payment = maturity today, Overdue = maturity passed; the monthly schedule is not used', async () => {
    db.queryNamed.mockResolvedValue([]);
    await portfolio.liveFacilitiesPaged({ due_today: '1' });
    const sql = db.queryNamed.mock.calls.map(([q]) => q).find((q) => q.includes('next_payment_due'));
    expect(sql).toMatch(/l\.maturity_date = CAST\(GETUTCDATE\(\) AS date\)\s+THEN [^]*AS next_payment_due/);
    expect(sql).toMatch(/l\.maturity_date < CAST\(GETUTCDATE\(\) AS date\)\s+THEN [^]*AS redemption_due/);
    expect(sql).not.toMatch(/loan_schedules/);
  });
});
