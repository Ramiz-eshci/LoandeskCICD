'use strict';

/**
 * In-app notifications (bell). Writes rows to dbo.notifications and reads the
 * current user's feed. Enquiry event helpers fan a single event out to the
 * right recipients. All creation is BEST-EFFORT: a notification failure must
 * never break the business action that triggered it (create/assign/status).
 */

const db = require('../config/database');

/** Users whose active/primary role holds (moduleKey, permKey). Returns [user_id]. */
async function usersWithPermission(moduleKey, permKey) {
  const rows = await db.query(
    `SELECT DISTINCT u.user_id AS id
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN role_permissions rp ON rp.role_id = COALESCE(ur.role_id, u.role_id)
       LEFT JOIN permissions p ON p.permission_id = rp.permission_id
       LEFT JOIN roles rr ON rr.role_id = rp.role_id
      WHERE u.flag_deleted = 0 AND u.is_active = 1
        AND rr.flag_deleted = 0 AND rr.is_active = 1
        AND p.module_key = @p0 AND p.permission_key = @p1`,
    [moduleKey, permKey],
  );
  return rows.map((r) => r.id);
}

/** Insert one notification. No-op on falsy userId. */
async function create({ userId, title, body = null, type = null, link = null, entityId = null }) {
  if (!userId) return;
  await db.query(
    `INSERT INTO notifications (user_id, title, body, type, link, entity_id)
     VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`,
    [userId, String(title).slice(0, 200), body ? String(body) : null, type, link, entityId],
  );
}

/** Insert the same notification for many users (deduped, nulls + actor removed). */
async function createMany(userIds, payload, excludeUserId = null) {
  const uniq = [...new Set((userIds || []).filter((id) => id && Number(id) !== Number(excludeUserId)))];
  for (const uid of uniq) {
    // eslint-disable-next-line no-await-in-loop
    await create({ ...payload, userId: uid });
  }
  return uniq.length;
}

// ---- feed (current user) ----

// Hide notifications for an enquiry that was deleted (soft delete) - the rows stay.
const NOT_DELETED_ENQUIRY = `NOT EXISTS (SELECT 1 FROM enquiries e
   WHERE e.enquiry_id = n.entity_id AND e.flag_deleted = 1 AND n.link = CONCAT('/enquiries/', n.entity_id))`;

async function listForUser(userId, { unreadOnly = false, limit = 30 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  return db.queryNamed(
    `SELECT TOP (${lim}) n.notification_id, n.title, n.body, n.type, n.link, n.entity_id, n.is_read, n.created_at
       FROM notifications n
      WHERE n.user_id = @uid ${unreadOnly ? 'AND n.is_read = 0' : ''} AND ${NOT_DELETED_ENQUIRY}
      ORDER BY n.created_at DESC`,
    { uid: userId },
  );
}

async function unreadCount(userId) {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM notifications n WHERE n.user_id = @p0 AND n.is_read = 0 AND ${NOT_DELETED_ENQUIRY}`, [userId]);
  return rows[0] ? rows[0].n : 0;
}

async function markRead(notificationId, userId) {
  await db.query(
    'UPDATE notifications SET is_read = 1 WHERE notification_id = @p0 AND user_id = @p1',
    [notificationId, userId]);
  return { ok: true };
}

async function markAllRead(userId) {
  await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = @p0 AND is_read = 0', [userId]);
  return { ok: true };
}

// ---- enquiry event fan-out (best-effort; swallow errors) ----

function linkFor(enquiryId) { return `/enquiries/${enquiryId}`; }

/** New enquiry (manual add / website / email). Notify assignee + everyone who can see all enquiries. */
async function enquiryCreated({ enquiryId, ref, assignedTo, source, actorId }) {
  try {
    const managers = await usersWithPermission('ENQUIRIES.ALL_ENQUIRIES', 'view');
    const recipients = [assignedTo, ...managers];
    const src = String(source || '').toLowerCase();
    const via = src === 'email' ? 'via email' : src === 'website' ? 'from the website' : 'added';
    await createMany(recipients, {
      title: `New enquiry ${ref || '#' + enquiryId}`,
      body: `A new enquiry was ${via}.`,
      type: 'ENQUIRY_NEW',
      link: linkFor(enquiryId),
      entityId: enquiryId,
    }, actorId);
  } catch (e) { /* best-effort */ }
}

/** Enquiry assigned/reassigned. Notify the new owner. */
async function enquiryAssigned({ enquiryId, ref, newOwner, actorId }) {
  try {
    if (!newOwner || Number(newOwner) === Number(actorId)) return;
    await create({
      userId: newOwner,
      title: `Enquiry ${ref || '#' + enquiryId} assigned to you`,
      body: 'You have been assigned a new enquiry.',
      type: 'ENQUIRY_ASSIGNED',
      link: linkFor(enquiryId),
      entityId: enquiryId,
    });
  } catch (e) { /* best-effort */ }
}

/** Enquiry status changed. Notify the current owner (assignee). */
async function enquiryStatusChanged({ enquiryId, ref, toCode, statusName, assignedTo, actorId }) {
  try {
    if (!assignedTo || Number(assignedTo) === Number(actorId)) return;
    await create({
      userId: assignedTo,
      title: `Enquiry ${ref || '#' + enquiryId} status updated`,
      body: `Status changed to ${statusName || toCode}.`,
      type: 'ENQUIRY_STATUS',
      link: linkFor(enquiryId),
      entityId: enquiryId,
    });
  } catch (e) { /* best-effort */ }
}

module.exports = {
  create, createMany, usersWithPermission,
  listForUser, unreadCount, markRead, markAllRead,
  enquiryCreated, enquiryAssigned, enquiryStatusChanged,
};
