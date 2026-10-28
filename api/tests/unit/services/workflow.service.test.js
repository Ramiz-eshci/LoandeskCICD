'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../services/audit.service', () => ({ write: jest.fn(), fromReq: jest.fn() }));

const db = require('../../../config/database');
const wf = require('../../../services/workflow.service');

describe('workflow.service / canTransition', () => {
  it('allows any target when there is no current status', () => {
    expect(wf.canTransition(null, 'ASSIGNED')).toBe(true);
  });

  it('allows a valid forward move', () => {
    expect(wf.canTransition('NEW', 'ASSIGNED')).toBe(true);
    expect(wf.canTransition('ASSIGNED', 'CONVERTED')).toBe(true);
  });

  it('allows lateral moves within the awaiting-info stage', () => {
    expect(wf.canTransition('CONTACTED', 'FOLLOW_UP')).toBe(true);
    expect(wf.canTransition('FOLLOW_UP', 'CONTACTED')).toBe(true);
  });

  it('forbids stepping back to an earlier stage', () => {
    expect(wf.canTransition('CONVERTED', 'ASSIGNED')).toBe(false);
    expect(wf.canTransition('QUALIFIED', 'NEW')).toBe(false);
    expect(wf.canTransition('OFFER_ACCEPTED', 'ASSIGNED')).toBe(false);
  });

  it('lets an offer (sent or accepted) go back to a new indicative / offer', () => {
    expect(wf.canTransition('QUALIFIED', 'INDICATIVE_SENT')).toBe(true);
    expect(wf.canTransition('OFFER_ACCEPTED', 'INDICATIVE_SENT')).toBe(true);
    expect(wf.canTransition('OFFER_ACCEPTED', 'QUALIFIED')).toBe(true);
  });

  it('is case-insensitive on the codes', () => {
    expect(wf.canTransition('new', 'assigned')).toBe(true);
  });
});

describe('workflow.service / shape', () => {
  it('marks CONVERTED, LOST and CLOSED as terminal with no transitions', () => {
    for (const code of ['CONVERTED', 'LOST', 'CLOSED']) {
      expect(wf.TERMINAL.has(code)).toBe(true);
      expect(wf.TRANSITIONS[code]).toEqual([]);
    }
  });
});

describe('workflow.service / applyStatus', () => {
  beforeEach(() => wf.clearCache());

  it('rejects an unknown status before touching the row', async () => {
    db.query.mockResolvedValueOnce([]); // statusMap: no rows -> idOf(target) = null
    const res = await wf.applyStatus(1, 'BOGUS', { userData: { userId: 1 } });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Unknown status');
  });
});
