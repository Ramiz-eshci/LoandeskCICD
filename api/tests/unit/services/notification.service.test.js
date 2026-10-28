'use strict';

/** In-app notifications: per-user isolation of the feed + best-effort enquiry fan-out. */

jest.mock('../../../config/database', () => ({ query: jest.fn(), queryNamed: jest.fn() }));
const db = require('../../../config/database');
const n = require('../../../services/notification.service');

beforeEach(() => { db.query.mockReset().mockResolvedValue([]); db.queryNamed.mockReset().mockResolvedValue([]); });
const inserts = () => db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO notifications'));

describe('feed is always scoped to the caller', () => {
  it('markRead only touches the caller\'s own notification (no IDOR)', async () => {
    await n.markRead(5, 42);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE notification_id = @p0 AND user_id = @p1'), [5, 42]);
  });

  it('markAllRead / unreadCount filter by user', async () => {
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ n: 3 }]);
    await n.markAllRead(42);
    expect(db.query.mock.calls[0]).toEqual([expect.stringContaining('WHERE user_id = @p0'), [42]]);
    expect(await n.unreadCount(42)).toBe(3);
    db.query.mockResolvedValueOnce([]);
    expect(await n.unreadCount(42)).toBe(0);
  });

  it('listForUser clamps the limit (no unbounded TOP) and can show unread only', async () => {
    await n.listForUser(42, { limit: 100000, unreadOnly: true });
    const [sql, params] = db.queryNamed.mock.calls[0];
    expect(sql).toContain('TOP (100)');
    expect(sql).toContain('AND n.is_read = 0');
    expect(params).toEqual({ uid: 42 });
    await n.listForUser(42, { limit: 'abc' });
    expect(db.queryNamed.mock.calls[1][0]).toContain('TOP (30)');
  });

  it('feed and unread count hide notifications of a deleted enquiry', async () => {
    await n.listForUser(42);
    expect(db.queryNamed.mock.calls[0][0]).toContain('e.flag_deleted = 1');
    await n.unreadCount(42);
    expect(db.query.mock.calls[0][0]).toContain('e.flag_deleted = 1');
  });
});

describe('create / createMany', () => {
  it('ignores a missing user and truncates long titles', async () => {
    await n.create({ userId: null, title: 'x' });
    expect(db.query).not.toHaveBeenCalled();
    await n.create({ userId: 1, title: 'T'.repeat(500) });
    expect(inserts()[0][1][1]).toHaveLength(200);
  });

  it('dedupes recipients and never notifies the actor', async () => {
    expect(await n.createMany([1, 2, 2, null, 3, '3'], { title: 't' }, 3)).toBe(2);
    expect(inserts().map((c) => c[1][0])).toEqual([1, 2]);
  });
});

describe('enquiry events', () => {
  it('enquiryCreated notifies the assignee + managers, says "via email"', async () => {
    db.query.mockResolvedValueOnce([{ id: 7 }, { id: 8 }]);
    await n.enquiryCreated({ enquiryId: 11, ref: 'ENQ-11', assignedTo: 5, source: 'email', actorId: 8 });
    expect(inserts().map((c) => c[1][0])).toEqual([5, 7]);
    expect(inserts()[0][1]).toEqual([5, 'New enquiry ENQ-11', 'A new enquiry was via email.', 'ENQUIRY_NEW', '/enquiries/11', 11]);
  });

  it('enquiryAssigned skips self-assignment', async () => {
    await n.enquiryAssigned({ enquiryId: 1, newOwner: 4, actorId: 4 });
    expect(inserts()).toHaveLength(0);
    await n.enquiryAssigned({ enquiryId: 1, ref: 'ENQ-1', newOwner: 4, actorId: 9 });
    expect(inserts()[0][1].slice(0, 2)).toEqual([4, 'Enquiry ENQ-1 assigned to you']);
  });

  it('enquiryStatusChanged notifies the owner with the status name', async () => {
    await n.enquiryStatusChanged({ enquiryId: 2, ref: 'ENQ-2', toCode: 'QUOTED', statusName: 'Quoted', assignedTo: 4, actorId: 9 });
    expect(inserts()[0][1][2]).toBe('Status changed to Quoted.');
  });

  it('never throws when the database fails (best-effort)', async () => {
    db.query.mockRejectedValue(new Error('down'));
    await expect(n.enquiryCreated({ enquiryId: 1 })).resolves.toBeUndefined();
    await expect(n.enquiryAssigned({ enquiryId: 1, newOwner: 2 })).resolves.toBeUndefined();
    await expect(n.enquiryStatusChanged({ enquiryId: 1, assignedTo: 2 })).resolves.toBeUndefined();
  });
});
