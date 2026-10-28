'use strict';

/**
 * Central workflow / status service (Module-4 point 3).
 *
 * The enquiry lifecycle lives HERE, not scattered across controllers. A status
 * change goes through applyStatus(), which:
 *   - resolves status codes <-> ids from the enquiry_statuses master,
 *   - enforces the allowed-transition graph,
 *   - persists enquiries.enquiry_status_id (+ audit column updated_by),
 *   - writes an ENQUIRY_STATUS_CHANGE audit row.
 *
 * Other modules can later register their own transition graphs and reuse the
 * same engine; for now it is scoped to the enquiry entity.
 */

const db = require('../config/database');
const audit = require('./audit.service');

const ENQUIRY_MODULE = 'ENQUIRIES.ENQUIRY_LIST';

/** Enquiry status codes (mirror seeder 20260101000006). */
const S = {
  NEW: 'NEW',
  UNASSIGNED: 'UNASSIGNED',
  ASSIGNED: 'ASSIGNED',
  CONTACTED: 'CONTACTED',
  FOLLOW_UP: 'FOLLOW_UP',
  INDICATIVE_SENT: 'INDICATIVE_SENT',
  QUALIFIED: 'QUALIFIED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  CONVERTED: 'CONVERTED',
  LOST: 'LOST',
  CLOSED: 'CLOSED',
};

/** Allowed transitions: from -> [to, ...]. Terminal states have none. */
/**
 * Forward-only enquiry lifecycle. Stage order:
 *   Draft(NEW/UNASSIGNED) -> Open(ASSIGNED) -> Awaiting Info(CONTACTED/FOLLOW_UP)
 *   -> Offer Sent(QUALIFIED) -> Offer Accepted(OFFER_ACCEPTED) -> Converted.
 * An enquiry can always be abandoned (LOST/CLOSED) from any active stage, and may
 * move laterally within the same stage (CONTACTED <-> FOLLOW_UP), but can never
 * step back to an earlier stage - except (client 26-10-2026) that once an offer is
 * sent or accepted it may go back to a new indicative / offer, since the client can
 * still change their mind before conversion. Super-admins bypass this via applyStatus force.
 */
const TRANSITIONS = {
  NEW: ['UNASSIGNED', 'ASSIGNED', 'LOST', 'CLOSED'],
  UNASSIGNED: ['ASSIGNED', 'LOST', 'CLOSED'],
  ASSIGNED: ['CONTACTED', 'FOLLOW_UP', 'INDICATIVE_SENT', 'QUALIFIED', 'CONVERTED', 'LOST', 'CLOSED'],
  CONTACTED: ['FOLLOW_UP', 'INDICATIVE_SENT', 'QUALIFIED', 'CONVERTED', 'LOST', 'CLOSED'],
  FOLLOW_UP: ['CONTACTED', 'INDICATIVE_SENT', 'QUALIFIED', 'CONVERTED', 'LOST', 'CLOSED'],
  INDICATIVE_SENT: ['INDICATIVE_SENT', 'QUALIFIED', 'CONVERTED', 'LOST', 'CLOSED'],
  QUALIFIED: ['INDICATIVE_SENT', 'QUALIFIED', 'OFFER_ACCEPTED', 'CONVERTED', 'LOST', 'CLOSED'],
  OFFER_ACCEPTED: ['INDICATIVE_SENT', 'QUALIFIED', 'CONVERTED', 'LOST', 'CLOSED'],
  CONVERTED: [],
  LOST: [],
  CLOSED: [],
};

const TERMINAL = new Set(['CONVERTED', 'LOST', 'CLOSED']);

let _cache = null; // { byCode: {CODE:id}, byId: {id:CODE} }

/** Load and cache the enquiry_statuses id<->code map. */
async function statusMap() {
  if (_cache) return _cache;
  const rows = await db.query(
    'SELECT enquiry_status_id AS id, code FROM enquiry_statuses WHERE flag_deleted = 0',
  );
  const byCode = {};
  const byId = {};
  for (const r of rows) {
    byCode[String(r.code).toUpperCase()] = r.id;
    byId[r.id] = String(r.code).toUpperCase();
  }
  _cache = { byCode, byId };
  return _cache;
}
/** Test hook / allow refresh after seeding. */
function clearCache() { _cache = null; }

async function idOf(code) {
  const m = await statusMap();
  return m.byCode[String(code).toUpperCase()] ?? null;
}
async function codeOf(id) {
  if (id == null) return null;
  const m = await statusMap();
  return m.byId[id] ?? null;
}

function canTransition(fromCode, toCode) {
  if (!fromCode) return true; // no current status (fresh row) -> anything
  const allowed = TRANSITIONS[String(fromCode).toUpperCase()] || [];
  return allowed.includes(String(toCode).toUpperCase());
}

async function currentCode(enquiryId) {
  const rows = await db.query(
    'SELECT enquiry_status_id FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0',
    [enquiryId],
  );
  if (!rows.length) return { found: false, code: null };
  return { found: true, code: await codeOf(rows[0].enquiry_status_id) };
}

/**
 * Apply a status change to an enquiry.
 * @returns {Promise<{ok:boolean, code?:string, error?:string, from?:string}>}
 */
async function applyStatus(enquiryId, toCode, req, opts = {}) {
  const target = String(toCode).toUpperCase();
  const toId = await idOf(target);
  if (toId == null) return { ok: false, error: 'Unknown status: ' + toCode };

  const { found, code: fromCode } = await currentCode(enquiryId);
  if (!found) return { ok: false, error: 'Enquiry not found' };

  if (!opts.force && !canTransition(fromCode, target)) {
    return { ok: false, error: `Cannot move enquiry from ${fromCode || 'NONE'} to ${target}`, from: fromCode };
  }

  await db.query(
    `UPDATE enquiries SET enquiry_status_id = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0`,
    [enquiryId, toId, req && req.userData ? req.userData.userId : null],
  );

  await audit.write(audit.fromReq(req, {
    action: 'ENQUIRY_STATUS_CHANGE',
    moduleKey: ENQUIRY_MODULE,
    entityName: 'enquiries',
    entityId: enquiryId,
    details: { from: fromCode, to: target, reason: opts.reason || null },
  }));

  return { ok: true, code: target, from: fromCode };
}

module.exports = {
  S,
  TRANSITIONS,
  TERMINAL,
  ENQUIRY_MODULE,
  statusMap,
  clearCache,
  idOf,
  codeOf,
  canTransition,
  currentCode,
  applyStatus,
};
