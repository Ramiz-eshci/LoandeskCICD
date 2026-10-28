'use strict';

/** Legal & Completion: stage whitelist, update allow-list (no mass assignment), completion guard. */

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn((req, x) => x) }));
jest.mock('../../../services/underwriting.service', () => ({}));

const db = require('../../../config/database');
const audit = require('../../../services/audit.service');
const legal = require('../../../services/legal.service');

const req = { userData: { userId: 42 } };
beforeEach(() => { db.query.mockReset().mockResolvedValue([]); audit.write.mockReset(); });
const sqlCalls = (frag) => db.query.mock.calls.filter(([sql]) => sql.includes(frag));

describe('legal.setStage', () => {
  it('only accepts the configured stages', async () => {
    expect(legal.STAGES).toEqual(['Offer Issued', 'Enquiries', 'Replies to Enquiries', 'Mortgage Deed', 'Completion']);
    expect(await legal.setStage(1, 'Hacked', req)).toEqual({ ok: false, error: 'Invalid legal stage' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('404s for a missing application', async () => {
    expect(await legal.setStage(1, 'Enquiries', req)).toEqual({ ok: false, notFound: true });
  });

  it('updates the stage and writes an audit entry', async () => {
    db.query.mockResolvedValueOnce([{ 1: 1 }]);
    expect(await legal.setStage(7, 'Mortgage Deed', req)).toEqual({ ok: true, stage: 'Mortgage Deed' });
    expect(sqlCalls('UPDATE applications')[0][1]).toEqual([7, 'Mortgage Deed', 42]);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEGAL_STAGE_CHANGE', details: { stage: 'Mortgage Deed' } }));
  });
});

describe('legal.updateCase', () => {
  it('only writes allow-listed columns (no mass assignment)', async () => {
    db.query.mockResolvedValueOnce([{ 1: 1 }]);
    await legal.updateCase(7, { lender_solicitor_id: 3, offer_date: '', application_status_id: 99, flag_deleted: 1, 'x=1;--': 1 }, req);
    const [sql, params] = sqlCalls('UPDATE applications')[0];
    expect(sql).toContain('lender_solicitor_id=@p0, offer_date=@p1');
    expect(sql).not.toMatch(/application_status_id|flag_deleted|x=1/);
    expect(params).toEqual([3, null, 42, 7]);
  });

  it('ignores an invalid legal_stage and is a no-op with nothing to change', async () => {
    db.query.mockResolvedValueOnce([{ 1: 1 }]);
    expect(await legal.updateCase(7, { legal_stage: 'Nope' }, req)).toEqual({ ok: true, id: 7 });
    expect(sqlCalls('UPDATE applications')).toHaveLength(0);
  });
});

describe('legal.toggleCondition', () => {
  it('flips Pending <-> Satisfied, scoped to the application', async () => {
    db.query.mockResolvedValueOnce([{ status: 'Pending' }]);
    expect(await legal.toggleCondition(7, 3, req)).toEqual({ ok: true, status: 'Satisfied' });
    expect(db.query.mock.calls[0][1]).toEqual([3, 7]);
    db.query.mockResolvedValueOnce([{ status: 'Satisfied' }]);
    expect((await legal.toggleCondition(7, 3, req)).status).toBe('Pending');
  });

  it('404s for a condition of another application', async () => {
    expect(await legal.toggleCondition(7, 3, req)).toEqual({ ok: false, notFound: true });
  });
});

describe('legal.complete', () => {
  it('refuses completion while conditions are outstanding', async () => {
    db.query
      .mockResolvedValueOnce([{ application_id: 7, application_ref: 'APP-7' }])
      .mockResolvedValueOnce([{ application_id: 7, met: 1, total: 2 }]);
    expect(await legal.complete(7, req)).toEqual({ ok: false, error: 'All conditions must be satisfied before completion' });
    expect(sqlCalls('UPDATE applications')).toHaveLength(0);
  });

  it('completes the application and legal case when every condition is met', async () => {
    db.query
      .mockResolvedValueOnce([{ application_id: 7, application_ref: 'APP-7' }])
      .mockResolvedValueOnce([{ application_id: 7, met: 2, total: 2 }])
      .mockResolvedValueOnce([{ id: 11 }])
      .mockResolvedValue([]);
    expect(await legal.complete(7, req)).toEqual({ ok: true });
    expect(sqlCalls('UPDATE applications')[0][1]).toEqual([7, 11, 42]);
    expect(sqlCalls("UPDATE legal_cases SET status='Completed'")).toHaveLength(1);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEGAL_COMPLETED' }));
  });

  it('404s for a missing application', async () => {
    expect(await legal.complete(7, req)).toEqual({ ok: false, notFound: true });
  });
});
