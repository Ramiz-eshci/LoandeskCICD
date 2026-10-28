'use strict';

/** Valuations tab = view of underwriting step 2; decide() writes back onto that step. */

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
const db = require('../../../config/database');
const svc = require('../../../services/valuations.service');

const row = (id, fields, extra = {}) => ({
  id, case_id: 1, application_id: 10 + id, application_ref: `APP-2026-000${id}`, amount_requested: 100000,
  ltv_pct: 65, data: JSON.stringify({ fields: { valuation_sent: true, ...fields } }), updated_at: '2026-10-20T10:00:00Z',
  property_address: `${id} High St`, ...extra,
});

beforeEach(() => db.query.mockReset());

describe('valuations.list', () => {
  const rows = [
    row(1, { valuer_firm: 'ACME', market_value: 250000 }),
    row(2, {}),
    row(3, { valuation_result: 'accepted', market_value: 300000 }),
    row(4, { valuation_result: 'rejected' }),
    row(5, { report_received: true }),
  ];

  it('derives status, money and refs from the step data', async () => {
    db.query.mockResolvedValueOnce(rows);
    const out = await svc.list({});
    const byId = Object.fromEntries(out.rows.map((r) => [r.id, r]));
    expect(byId[1]).toMatchObject({ ref: 'VAL-001', applicationId: 'APP-2026-0001', valuer: 'ACME', marketValue: '£250,000', ltv: '65%', statusKey: 'report-received' });
    expect(byId[2]).toMatchObject({ statusKey: 'instructed', status: 'Instructed', valuer: '—', marketValue: null });
    expect(byId[5].statusKey).toBe('report-received');
  });

  it('splits active / completed tabs and counts every status', async () => {
    db.query.mockResolvedValue(rows);
    const active = await svc.list({ tab: 'active' });
    expect(active.rows.map((r) => r.id)).toEqual([1, 2, 5]);
    expect(active.counts).toEqual({ active: 3, completed: 2, instructed: 1, 'report-received': 2, accepted: 1, rejected: 1 });
    const done = await svc.list({ tab: 'completed' });
    expect(done.rows.map((r) => r.id)).toEqual([3, 4]);
  });

  it('pages with sane bounds', async () => {
    db.query.mockResolvedValue(rows);
    expect((await svc.list({ per_page: 2, page: 2 })).meta).toEqual({ page: 2, per_page: 2, total: 3, total_pages: 2 });
    expect((await svc.list({ per_page: 9999, page: -5 })).meta).toMatchObject({ page: 1, per_page: 100 });
  });

  it('only lists steps that were actually sent to the valuation team', async () => {
    db.query.mockResolvedValueOnce([]);
    await svc.list({});
    expect(db.query.mock.calls[0][0]).toContain("JSON_VALUE(s.data, '$.fields.valuation_sent') = 'true'");
    expect(db.query.mock.calls[0][0]).toContain('s.step_no = 2');
  });
});

describe('valuations.decide', () => {
  const step = (fields = {}) => [{ underwriting_case_id: 1, step_no: 2, data: JSON.stringify({ fields: { valuation_sent: true, ...fields }, other: 'keep' }) }];
  const saved = () => JSON.parse(db.query.mock.calls[1][1][1]);

  it('returns notFound for a missing step or a step that is not step 2', async () => {
    db.query.mockResolvedValueOnce([]);
    expect(await svc.decide(9, { result: 'accepted' })).toEqual({ ok: false, notFound: true });
    db.query.mockResolvedValueOnce([{ step_no: 3, data: '{}' }]);
    expect(await svc.decide(9, { result: 'accepted' })).toEqual({ ok: false, notFound: true });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown result without writing', async () => {
    db.query.mockResolvedValueOnce(step());
    expect(await svc.decide(9, { result: 'maybe' })).toMatchObject({ ok: false, errors: { result: expect.any(String) } });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('accept stores the result + report figures and keeps other step data', async () => {
    db.query.mockResolvedValueOnce(step()).mockResolvedValueOnce([]);
    expect(await svc.decide(9, { result: 'accepted', market_value: 250000, gdv_value: 400000, recommendation: 'ok' })).toEqual({ ok: true, id: 9, result: 'accepted' });
    expect(saved()).toEqual({ other: 'keep', fields: { valuation_sent: true, market_value: 250000, gdv_value: 400000, valuation_recommendation: 'ok', valuation_result: 'accepted' } });
  });

  it('"received" only flags the report as received', async () => {
    db.query.mockResolvedValueOnce(step()).mockResolvedValueOnce([]);
    await svc.decide(9, { result: 'received', market_value: 1 });
    expect(saved().fields).toEqual({ valuation_sent: true, report_received: true });
  });
});
