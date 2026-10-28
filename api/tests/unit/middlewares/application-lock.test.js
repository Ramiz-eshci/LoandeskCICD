'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../config/application.config', () => ({ LOCKED_STATUSES: ['APPROVED', 'LEGAL'] }));

const db = require('../../../config/database');
const { requireUnlocked } = require('../../../middlewares/application-lock');

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('middleware/application-lock requireUnlocked', () => {
  it('super admins bypass the lock', async () => {
    const next = jest.fn();
    await requireUnlocked({ userData: { isSuperAdmin: true }, params: { id: '1' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('404 when the application is missing', async () => {
    db.query.mockResolvedValueOnce([]);
    const res = mockRes();
    await requireUnlocked({ userData: {}, params: { id: '9' } }, res, jest.fn());
    expect(res.statusCode).toBe(404);
  });

  it('403 on a locked status', async () => {
    db.query.mockResolvedValueOnce([{ code: 'APPROVED' }]);
    const res = mockRes();
    await requireUnlocked({ userData: {}, params: { id: '9' } }, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });

  it('allows an editable (unlocked) status', async () => {
    db.query.mockResolvedValueOnce([{ code: 'DRAFT' }]);
    const next = jest.fn();
    await requireUnlocked({ userData: {}, params: { id: '9' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
