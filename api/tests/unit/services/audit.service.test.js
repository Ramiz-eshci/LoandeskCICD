'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ warn: jest.fn() }));

const db = require('../../../config/database');
const audit = require('../../../services/audit.service');

describe('audit.service / fromReq', () => {
  it('pulls the actor id and ip from the request', () => {
    const out = audit.fromReq(
      { userData: { userId: 7 }, clientIp: '1.2.3.4' },
      { action: 'X', entityId: 9 },
    );
    expect(out).toMatchObject({ userId: 7, ip: '1.2.3.4', action: 'X', entityId: 9 });
  });

  it('tolerates a missing request', () => {
    const out = audit.fromReq(null, { action: 'X' });
    expect(out.userId).toBeNull();
    expect(out.ip).toBeNull();
  });
});

describe('audit.service / mergeTrails', () => {
  it('merges and sorts rows newest-first', () => {
    const a = [{ created_at: '2026-01-01T00:00:00Z', id: 1 }];
    const b = [{ created_at: '2026-03-01T00:00:00Z', id: 2 }];
    const out = audit.mergeTrails(a, b);
    expect(out.map((r) => r.id)).toEqual([2, 1]);
  });

  it('ignores non-array inputs', () => {
    expect(audit.mergeTrails(null, undefined, [{ created_at: '2026-01-01', id: 1 }]).length).toBe(1);
  });
});

describe('audit.service / write', () => {
  it('writes an audit row', async () => {
    db.query.mockResolvedValueOnce([]);
    await audit.write({ userId: 1, action: 'X', entityName: 'enquiries', entityId: 9 });
    expect(db.query).toHaveBeenCalled();
  });

  it('never throws when the DB write fails (best-effort)', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    await expect(audit.write({ action: 'X' })).resolves.toBeUndefined();
  });
});
