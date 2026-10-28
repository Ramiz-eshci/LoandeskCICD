'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
jest.mock('../../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn() }));

const db = require('../../../config/database');
const credit = require('../../../services/credit.service');

describe('credit.service / decide validation', () => {
  const req = { userData: { userId: 1 } };

  it('rejects an invalid decision before any DB write', async () => {
    const out = await credit.decide(1, { decision: 'maybe', comments: 'x' }, req);
    expect(out).toEqual({ ok: false, error: 'Invalid decision' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires comments', async () => {
    const out = await credit.decide(1, { decision: 'approve', comments: '' }, req);
    expect(out).toEqual({ ok: false, error: 'Comments are required' });
  });

  it('requires conditions when approving with conditions', async () => {
    const out = await credit.decide(1, { decision: 'approve_conditions', comments: 'ok', conditions: '' }, req);
    expect(out).toEqual({ ok: false, error: 'Conditions are required' });
  });

  it('reports notFound when the application does not exist', async () => {
    db.query.mockResolvedValueOnce([]); // app lookup
    const out = await credit.decide(99, { decision: 'decline', comments: 'no' }, req);
    expect(out).toEqual({ ok: false, notFound: true });
  });
});

describe('credit.service / exports', () => {
  it('exposes the legal stage list and module key', () => {
    expect(Array.isArray(credit.LEGAL_STAGES)).toBe(true);
    expect(credit.MODULE_KEY).toBe('CREDIT');
  });
});
