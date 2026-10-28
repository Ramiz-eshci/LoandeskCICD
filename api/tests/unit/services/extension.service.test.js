'use strict';

/** Portfolio extensions: date maths + workflow guards (who can decide / cancel / submit when). */

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
jest.mock('../../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn((req, x) => x) }));
jest.mock('../../../services/mail.service', () => ({}));
jest.mock('../../../services/emailHub.service', () => ({}));
jest.mock('../../../services/notification.service', () => ({ createMany: jest.fn() }));
jest.mock('../../../services/application.service', () => ({}));
jest.mock('../../../services/pdf/extension-pdf.service', () => ({}));

const db = require('../../../config/database');
const audit = require('../../../services/audit.service');
const notifications = require('../../../services/notification.service');
const ext = require('../../../services/extension.service');

const req = { userData: { userId: 42 } };
const X = (over = {}) => ({
  extension_id: 3, extension_ref: 'EXT-000003', loan_id: 9, status: ext.S.PENDING, loan_status: 'Active',
  extension_months: 2, monthly_interest: 1000, interest_treatment: 'Serviced', new_maturity: '2027-03-31', ...over,
});
const updates = (table) => db.query.mock.calls.filter(([sql]) => sql.includes(`UPDATE ${table}`));

beforeEach(() => {
  db.query.mockReset().mockResolvedValue([]);
  db.queryNamed.mockReset().mockResolvedValue([]);
  audit.write.mockReset();
  notifications.createMany.mockReset();
});

describe('extension.addMonths (calendar-safe)', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-10-15', 3, '2027-01-15'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-05-10', 0, '2026-05-10'],
  ])('%s + %i months = %s', (d, m, out) => expect(ext.addMonths(d, m)).toBe(out));

  it('accepts Date objects and rejects junk', () => {
    expect(ext.addMonths(new Date('2026-06-30T00:00:00Z'), 6)).toBe('2026-12-30');
    expect(ext.addMonths('31/01/2026', 1)).toBeNull();
    expect(ext.addMonths(null, 1)).toBeNull();
  });
});

describe('extension status model', () => {
  it('open / editable sets', () => {
    expect(ext.OPEN).toEqual(['Draft', 'Agreement Sent', 'Agreement Signed', 'Pending Approval']);
    expect(ext.EDITABLE).toEqual(['Draft', 'Agreement Sent', 'Agreement Signed']);
  });
});

describe('extension.decide', () => {
  it('404 when the extension does not exist', async () => {
    expect(await ext.decide(99, { decision: 'approve' }, req)).toEqual({ ok: false, notFound: true });
  });

  it.each(['Draft', 'Agreement Signed', 'Approved', 'Rejected', 'Cancelled'])('refuses to decide a %s extension', async (status) => {
    db.query.mockResolvedValueOnce([X({ status })]);
    expect(await ext.decide(3, { decision: 'approve' }, req)).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
    expect(updates('loans')).toHaveLength(0);
  });

  it('requires approve|reject and a reason to reject', async () => {
    db.query.mockResolvedValueOnce([X()]);
    expect((await ext.decide(3, { decision: 'maybe' }, req)).errors).toHaveProperty('decision');
    db.query.mockResolvedValueOnce([X()]);
    expect((await ext.decide(3, { decision: 'reject', notes: '  ' }, req)).errors).toHaveProperty('notes');
  });

  it('will not extend a facility that is no longer Active', async () => {
    db.query.mockResolvedValueOnce([X({ loan_status: 'Redeemed' })]);
    expect((await ext.decide(3, { decision: 'approve' }, req)).errors.status).toMatch(/Redeemed/);
    expect(updates('loans')).toHaveLength(0);
  });

  it('reject records the decision, audits and notifies - loan untouched', async () => {
    db.query.mockResolvedValueOnce([X()]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ created_by: 5, submitted_by: 6 }]);
    expect(await ext.decide(3, { decision: 'REJECT', notes: 'Exit not evidenced' }, req)).toMatchObject({ ok: true });
    expect(updates('loans')).toHaveLength(0);
    expect(updates('portfolio_extensions')[0][1]).toEqual([3, 'Rejected', 'Exit not evidenced', 42]);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTENSION_REJECTED' }));
    expect(notifications.createMany.mock.calls[0][0]).toEqual([5, 6]);
  });

  it('approve moves the maturity, adds the schedule and marks it Approved', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM portfolio_extensions x') || sql.includes('WHERE x.extension_id')) return [X()];
      if (sql.includes('MAX(installment_no)')) return [{ n: 12 }];
      return [];
    });
    expect(await ext.decide(3, { decision: 'approve' }, req)).toMatchObject({ ok: true });
    expect(updates('loans')[0][1]).toEqual([9, '2027-03-31', 2, 42]);
    const sched = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO loan_schedules')).map((c) => c[1]);
    expect(sched).toEqual([[9, 13, null, 1000, 42], [9, 14, null, 1000, 42]]); // serviced: interest every month
    expect(updates('portfolio_extensions')[0][1].slice(1, 2)).toEqual(['Approved']);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTENSION_APPROVED' }));
  });
});

describe('extension.decide - retained interest + fees', () => {
  it('retained interest is charged in full on the last new instalment; fees added', async () => {
    const x = X({ interest_treatment: 'Retained', extension_months: 3, current_maturity: '2026-12-31', ext_fee_amount: 1500, ext_fee_timing: 'Retained', doc_fee_amount: 0 });
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('WHERE x.extension_id')) return [x];
      if (sql.includes('MAX(installment_no)')) return [{ n: 0 }];
      return [];
    });
    await ext.decide(3, { decision: 'approve' }, req);
    const sched = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO loan_schedules')).map((c) => c[1]);
    expect(sched).toEqual([
      [9, 1, '2027-01-31', 0, 42],
      [9, 2, '2027-02-28', 0, 42],
      [9, 3, '2027-03-31', 3000, 42],
    ]);
    const fees = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO loan_fees')).map((c) => c[1]);
    expect(fees).toHaveLength(1); // zero documentation fee is skipped
    expect(fees[0].slice(0, 4)).toEqual([9, 'Extension', 1500, '2027-03-31']);
  });
});

// Client 28-10-2026: each fee is Upfront (separate charge) or Retained (added to the gross).
describe('extension fees - upfront / retained', () => {
  const base = {
    extension_months: 2, current_maturity: '2027-08-12', gross_amount: 238205, net_amount: 200045,
    ext_fee_type: 'PCT', ext_fee_value: 2, doc_fee_type: 'AMOUNT', doc_fee_value: 1000,
    ext_fee_timing: 'Upfront', doc_fee_timing: 'Upfront', monthly_rate_pct: 1,
  };

  it('upfront fees leave the gross and the interest base alone', () => {
    const x = ext.derive(base);
    expect(x.ext_fee_amount).toBe(4764.1);
    expect(x.retained_fees).toBe(0);
    expect(x.gross_after).toBe(238205);
    expect(x.monthly_interest).toBe(2382.05);
  });

  it('retained fees grow the gross; fee % stays on the original gross; % interest runs on the new gross', () => {
    const x = ext.derive({ ...base, ext_fee_timing: 'Retained', doc_fee_timing: 'Retained' });
    expect(x.ext_fee_amount).toBe(4764.1);
    expect(x.retained_fees).toBe(5764.1);
    expect(x.gross_after).toBe(243969.1);
    expect(x.monthly_interest).toBe(2439.69);
  });

  it('a manual monthly interest amount is kept as entered', () => {
    const x = ext.derive({ ...base, monthly_rate_pct: 0, monthly_interest: 1000, ext_fee_timing: 'Retained' });
    expect(x.monthly_interest).toBe(1000);
    expect(x.gross_after).toBe(242969.1);
  });

  const approve = async (over) => {
    const x = X({ current_maturity: '2027-08-12', new_maturity: '2027-10-12', gross_amount: 238205, ...over });
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('WHERE x.extension_id')) return [x];
      if (sql.includes('MAX(installment_no)')) return [{ n: 0 }];
      return [];
    });
    return ext.decide(3, { decision: 'approve' }, req);
  };
  const feeRows = () => db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO loan_fees')).map((c) => c[1]);
  const completes = () => db.query.mock.calls.filter(([sql]) => sql.includes('SET completed_at'));

  it('retained: gross + outstanding grow by the fee, fee kept as Capitalised, extension complete', async () => {
    const out = await approve({ ext_fee_amount: 4764.1, ext_fee_timing: 'Retained', doc_fee_amount: 1000, doc_fee_timing: 'Retained' });
    expect(out).toMatchObject({ ok: true, awaitingFees: false });
    const grow = db.query.mock.calls.find(([sql]) => sql.includes('UPDATE loans SET principal'));
    expect(grow[1]).toEqual([9, 5764.1, 42]);
    expect(feeRows().map((r) => r[6])).toEqual(['Capitalised', 'Capitalised']);
    expect(completes()).toHaveLength(1);
  });

  it('upfront: gross untouched, fees Due, extension waits for the fees', async () => {
    const out = await approve({ ext_fee_amount: 4764.1, ext_fee_timing: 'Upfront', doc_fee_amount: 0, doc_fee_timing: 'Upfront' });
    expect(out).toMatchObject({ ok: true, awaitingFees: true });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('UPDATE loans SET principal'))).toBe(false);
    expect(feeRows()).toHaveLength(1);
    expect(feeRows()[0].slice(0, 4)).toEqual([9, 'Extension', 4764.1, '2027-08-12']);
    expect(feeRows()[0][6]).toBe('Due');
    expect(feeRows()[0][7]).toBe(3); // linked to the extension
    expect(completes()).toHaveLength(0);
  });

  it('mixed: only the retained fee goes into the gross', async () => {
    await approve({ ext_fee_amount: 4764.1, ext_fee_timing: 'Retained', doc_fee_amount: 1000, doc_fee_timing: 'Upfront' });
    expect(db.query.mock.calls.find(([sql]) => sql.includes('UPDATE loans SET principal'))[1][1]).toBe(4764.1);
    expect(feeRows().map((r) => r[6])).toEqual(['Capitalised', 'Due']);
    expect(completes()).toHaveLength(0);
  });
});

describe('extension.markFeePaid', () => {
  const approved = X({ status: 'Approved' });
  it('only on an approved extension, only a Due fee of that extension', async () => {
    db.query.mockResolvedValueOnce([X({ status: 'Pending Approval' })]);
    expect((await ext.markFeePaid(3, 1, { paid_on: '2026-10-01' }, req)).errors.status).toMatch(/approved/);
    db.query.mockResolvedValueOnce([approved]).mockResolvedValueOnce([]);
    expect(await ext.markFeePaid(3, 1, { paid_on: '2026-10-01' }, req)).toEqual({ ok: false, notFound: true });
    db.query.mockResolvedValueOnce([approved]).mockResolvedValueOnce([{ fee_id: 1, status: 'Capitalised' }]);
    expect((await ext.markFeePaid(3, 1, { paid_on: '2026-10-01' }, req)).errors.status).toMatch(/Capitalised/);
  });

  it('needs a payment date that is not in the future', async () => {
    db.query.mockResolvedValueOnce([approved]).mockResolvedValueOnce([{ fee_id: 1, status: 'Due' }]);
    expect((await ext.markFeePaid(3, 1, {}, req)).errors).toHaveProperty('paid_on');
    db.query.mockResolvedValueOnce([approved]).mockResolvedValueOnce([{ fee_id: 1, status: 'Due' }]);
    expect((await ext.markFeePaid(3, 1, { paid_on: '2999-01-01' }, req)).errors.paid_on).toMatch(/future/);
  });

  it('marks it Paid and completes the extension when no upfront fee is left', async () => {
    db.query.mockResolvedValueOnce([approved])
      .mockResolvedValueOnce([{ fee_id: 1, fee_type: 'Extension', amount: 4764.1, status: 'Due' }])
      .mockResolvedValueOnce([])              // UPDATE loan_fees
      .mockResolvedValueOnce([{ id: 3 }]);    // syncCompletion
    expect(await ext.markFeePaid(3, 1, { paid_on: '2026-10-01', method: 'Bank Transfer', reference: 'BACS 1' }, req))
      .toEqual({ ok: true, completed: true });
    expect(updates('loan_fees')[0][1]).toEqual([1, '2026-10-01', 'Bank Transfer', 'BACS 1', 42]);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTENSION_FEE_PAID' }));
  });
});

describe('extension.cancel / submit guards', () => {
  it.each(['Pending Approval', 'Approved', 'Rejected', 'Cancelled'])('cannot cancel a %s extension', async (status) => {
    db.query.mockResolvedValueOnce([X({ status })]);
    expect(await ext.cancel(3, {}, req)).toMatchObject({ ok: false, errors: { status: expect.stringContaining(status) } });
  });

  it('cancels an editable extension with the reason', async () => {
    db.query.mockResolvedValueOnce([X({ status: 'Draft' })]);
    expect(await ext.cancel(3, { reason: 'Client withdrew' }, req)).toEqual({ ok: true });
    expect(updates('portfolio_extensions')[0][1]).toEqual([3, 'Client withdrew', 42]);
  });

  it('cannot be sent to the Head of Extension before the signed agreement is uploaded', async () => {
    db.query.mockResolvedValueOnce([X({ status: 'Agreement Sent', signed_document_id: null })]);
    expect((await ext.submit(3, {}, req)).errors.status).toMatch(/signed Extension Agreement/);
    db.query.mockResolvedValueOnce([X({ status: 'Agreement Signed', signed_document_id: null })]);
    expect((await ext.submit(3, {}, req)).ok).toBe(false);
  });

  // Client 27-10-2026: recipients are the ticked heads + typed addresses; none -> not sent.
  it('refuses to send with no head ticked and no address typed (nothing changes)', async () => {
    const signed = X({ status: 'Agreement Signed', signed_document_id: 7 });
    const heads = [{ user_id: 5, full_name: 'Head One', email: 'head@x.com' }];
    db.query.mockResolvedValueOnce([signed]).mockResolvedValueOnce(heads);
    expect((await ext.submit(3, { heads: [], to: '' }, req)).errors.to).toMatch(/Tick a Head of Extension/);
    db.query.mockResolvedValueOnce([signed]).mockResolvedValueOnce(heads);
    expect((await ext.submit(3, { heads: [], to: 'not-an-email' }, req)).errors.to).toMatch(/not-an-email/);
    // A head id that is not a Head of Extension does not count.
    db.query.mockResolvedValueOnce([signed]).mockResolvedValueOnce(heads);
    expect((await ext.submit(3, { heads: [999] }, req)).ok).toBe(false);
    expect(updates('portfolio_extensions')).toHaveLength(0);
  });
});

describe('extension.inScope', () => {
  it('admins / all-scope users skip the check', async () => {
    expect(await ext.inScope(3, null)).toBe(true);
    expect(db.queryNamed).not.toHaveBeenCalled();
  });

  it('scoped users only see extensions on their own deals', async () => {
    db.queryNamed.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ok: 1 }]);
    expect(await ext.inScope(3, 42)).toBe(false);
    expect(await ext.inScope('3', '42')).toBe(true);
    expect(db.queryNamed.mock.calls[0][1]).toEqual({ id: 3, uid: 42 });
  });
});
