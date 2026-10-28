'use strict';

/**
 * Audit logging (Module-1 point 9). Writes to dbo.audit_logs.
 * Best-effort: an audit failure must NEVER break the underlying request,
 * so every write is wrapped and swallowed with a server-side warn.
 */

const db = require('../config/database');
const T = require('../controllers/common/table.controller');
const logger = require('../utils/logger');

async function write({ userId, action, moduleKey, entityName, entityId, details, ip } = {}) {
  try {
    await db.query(
      `INSERT INTO ${T.TBL_AUDIT_LOGS}
         (user_id, action, module_key, entity_name, entity_id, details, ip_address)
       VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)`,
      [
        userId != null ? Number(userId) : null,
        String(action || 'UNKNOWN').slice(0, 50),
        moduleKey ? String(moduleKey).slice(0, 100) : null,
        entityName ? String(entityName).slice(0, 100) : null,
        entityId != null ? String(entityId).slice(0, 60) : null,
        details != null ? JSON.stringify(details).slice(0, 3900) : null,
        ip ? String(ip).slice(0, 60) : null,
      ],
    );
  } catch (e) {
    try { logger.warn('[audit] write failed:', e && e.message); } catch (_) { /* ignore */ }
  }
}

/** Convenience: pull the actor id + ip from an Express request. */
function fromReq(req, fields) {
  return {
    userId: req && req.userData ? req.userData.userId : null,
    ip: req ? req.clientIp || req.ip : null,
    ...fields,
  };
}

/**
 * Read the full trail for one entity, newest first.
 *
 * The enquiry Audit tab previously showed assignment history only, while every
 * edit, status change, indicative and offer was being written here and never
 * read back. IX_audit_entity(entity_name, entity_id) covers this lookup.
 *
 * `details` is stored as JSON text; it is parsed here so the client never has
 * to, and a malformed row degrades to null rather than breaking the list.
 */
async function listForEntity(entityName, entityId, { limit = 300 } = {}) {
  const rows = await db.query(
    `SELECT TOP (@p2) al.audit_id, al.action, al.module_key, al.entity_name, al.entity_id,
            al.details, al.created_at, al.user_id, u.full_name AS user_name
       FROM ${T.TBL_AUDIT_LOGS} al
       LEFT JOIN users u ON u.user_id = al.user_id
      WHERE al.entity_name = @p0 AND al.entity_id = @p1
      ORDER BY al.audit_id DESC`,
    [String(entityName), String(entityId), Number(limit) || 300],
  );
  return rows.map((r) => {
    let details = null;
    try { details = r.details ? JSON.parse(r.details) : null; } catch (e) { details = null; }
    return { ...r, details };
  });
}

/**
 * The trail for a WHOLE CASE, not one record.
 *
 * A case is one continuous story: an enquiry becomes an application, which
 * opens an underwriting case. Read per-entity, the underwriting screen shows
 * only its own rows and the earlier history looks lost. This merges every link
 * in the chain into one list, newest first, tagging each row with the module it
 * came from so the reader can see where in the journey it happened.
 *
 * @param {{entity: string, id: number|string, module: string}[]} links
 */
async function listForChain(links, { limit = 500 } = {}) {
  const valid = (links || []).filter((l) => l && l.entity && l.id != null);
  if (!valid.length) return [];

  const where = valid.map((_, i) => `(al.entity_name = @p${i * 2} AND al.entity_id = @p${i * 2 + 1})`).join(' OR ');
  const params = [];
  valid.forEach((l) => { params.push(String(l.entity), String(l.id)); });
  params.push(Number(limit) || 500);

  const rows = await db.query(
    `SELECT TOP (@p${params.length - 1}) al.audit_id, al.action, al.module_key, al.entity_name, al.entity_id,
            al.details, al.created_at, al.user_id, u.full_name AS user_name, r.role_name
       FROM ${T.TBL_AUDIT_LOGS} al
       LEFT JOIN users u ON u.user_id = al.user_id
       LEFT JOIN roles r ON r.role_id = u.role_id
      WHERE ${where}
      ORDER BY al.created_at DESC, al.audit_id DESC`,
    params,
  );

  const moduleOf = {};
  valid.forEach((l) => { moduleOf[String(l.entity)] = l.module || l.entity; });

  return rows.map((row) => {
    let details = null;
    try { details = row.details ? JSON.parse(row.details) : null; } catch (e) { details = null; }
    return { ...row, details, module: moduleOf[String(row.entity_name)] || row.entity_name };
  });
}

/** Merge already-shaped rows from several sources into one newest-first list. */
function mergeTrails(...lists) {
  return []
    .concat(...lists.filter(Array.isArray))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

module.exports = { write, fromReq, listForEntity, listForChain, mergeTrails };
