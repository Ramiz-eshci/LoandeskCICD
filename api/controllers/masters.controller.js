'use strict';

/**
 * Generic Master CRUD (Module-3). One controller drives every master listed in
 * config/masters.config.js — paginated list, get, create, update, deactivate.
 *  - Server-side validation per field (never trusts the client).
 *  - Logical delete only (is_active=0); financial/master data is never removed.
 *  - Audit entry on create/update/deactivate.
 *  - RBAC: MASTER.<SLUG>.<action> (System Administrator bypasses via is_super_admin).
 * Table/column identifiers come ONLY from the trusted registry, never user input.
 */

const db = require('../config/database');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const audit = require('../services/audit.service');
const REG = require('../config/masters.config');
const { own } = require('../utils/own');

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const MASTER_MODULE = {
  branch: 'MASTERS.BRANCH_MASTER',
  product: 'MASTERS.PRODUCT_MASTER',
  broker: 'BROKERS',
  solicitor: 'MASTERS.SOLICITOR_VALUER_MASTER',
  valuer: 'MASTERS.SOLICITOR_VALUER_MASTER',
  'loan-purpose': 'MASTERS.LOAN_PURPOSE_MASTER',
  'applicant-type': 'MASTERS.APPLICANT_TYPE_MASTER',
  'lead-source': 'MASTERS.LEAD_SOURCE_MASTER',
  'application-status': 'MASTERS.APPLICATION_STATUS_MASTER',
  'enquiry-status': 'MASTERS.ENQUIRY_STATUS_MASTER',
  'document-type': 'MASTERS.DOCUMENT_TYPE_MASTER',
  'valuation-type': 'MASTERS.VALUATION_TYPE_MASTER',
  roi: 'MASTERS.ROI_MASTER',
  'repayment-frequency': 'MASTERS.REPAYMENT_FREQUENCY_MASTER',
  'application-source': 'MASTERS.APPLICATION_SOURCE_MASTER',
  'contact-method': 'MASTERS.CONTACT_METHOD_MASTER',
  'followup-status': 'MASTERS.FOLLOWUP_STATUS_MASTER',
  'contact-outcome': 'MASTERS.CONTACT_OUTCOME_MASTER',
  'rejection-reason': 'MASTERS.REJECTION_REASON_MASTER',
  'approval-condition': 'MASTERS.APPROVAL_CONDITION_MASTER',
  'kyc-check': 'MASTERS.KYC_CHECK_MASTER',
  'solicitor-check': 'MASTERS.SOLICITOR_CHECK_MASTER',
  'decline-reason': 'MASTERS.DECLINE_REASON_MASTER',
  'borrower-solicitor': 'MASTERS.BORROWER_SOLICITOR_MASTER',
  'solicitor-cost-type': 'MASTERS.SOLICITOR_COST_TYPE_MASTER',
};
// Everything else (product-type, statuses, purposes, roi, terms, ...) -> Common Masters.
const moduleKey = (key) => MASTER_MODULE[key] || 'MASTERS.COMMON_MASTERS';

function getCfg(res, key) {
  const cfg = own(REG, key);
  if (!cfg) {
    R.notFound(res, 'Unknown master: ' + key);
    return null;
  }
  return cfg;
}

const RX = {
  code: /^[A-Za-z0-9_-]+$/,
  text: /^[A-Za-z0-9 .,&/'()\-]+$/,
  phone: /^[0-9+()\-\s]+$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
};

/** Server-side validation + coercion against the registry (never trusts the client). */
function validate(body, cfg) {
  const errors = {};
  const values = {};
  for (const col of cfg.columns) {
    const raw = body[col.name];
    if (raw === undefined || raw === null || raw === '') {
      if (col.required) errors[col.name] = 'This field is required';
      else values[col.name] = null;
      continue;
    }
    const v = typeof raw === 'string' ? raw.trim() : raw;
    switch (col.type) {
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n)) errors[col.name] = 'Must be a whole number';
        else values[col.name] = n;
        break;
      }
      case 'decimal':
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) errors[col.name] = 'Must be a number';
        else values[col.name] = n;
        break;
      }
      case 'select': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) errors[col.name] = 'Please select a valid option';
        else values[col.name] = n;
        break;
      }
      case 'bool':
        values[col.name] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
        break;
      case 'email':
        if (!RX.email.test(String(v))) errors[col.name] = 'Enter a valid email address';
        else values[col.name] = String(v);
        break;
      case 'phone':
        if (!RX.phone.test(String(v))) errors[col.name] = 'Enter a valid phone number';
        else values[col.name] = String(v);
        break;
      case 'code':
        if (!RX.code.test(String(v))) errors[col.name] = 'Only letters, digits, _ and - allowed';
        else values[col.name] = String(v);
        break;
      case 'date':
        values[col.name] = String(v);
        break;
      default: // text
        if (!RX.text.test(String(v))) errors[col.name] = 'Special characters are not allowed';
        else values[col.name] = String(v);
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

/** Next auto business code for a master: PREFIX-0001, PREFIX-0002, ... (per-master counter). */
async function nextCode(cfg) {
  const { field, prefix } = cfg.autoCode;
  const start = prefix.length + 2; // 1-based position of the first digit after "PREFIX-"
  const rows = await db.query(
    `SELECT MAX(TRY_CONVERT(INT, SUBSTRING(${field}, ${start}, 20))) AS n
       FROM ${cfg.table} WHERE ${field} LIKE @p0`,
    [prefix + '-%'],
  );
  const n = rows[0] && rows[0].n ? rows[0].n : 0;
  return `${prefix}-${String(n + 1).padStart(4, '0')}`;
}

/**
 * Duplicate check for `cfg.unique` plus every column in `cfg.uniqueAlso`.
 * Returns an error message, or null when the row is fine.
 * `skipId` excludes the row being edited. Comparison is the column's own
 * collation, which for these NVARCHAR columns is case-insensitive.
 */
async function duplicateOf(cfg, values, skipId) {
  const cols = [];
  // `unique` is skipped for auto-generated codes: the server owns that value.
  if (cfg.unique && !cfg.autoCode) cols.push(cfg.unique);
  for (const c of cfg.uniqueAlso || []) cols.push(c);
  for (const col of cols) {
    const v = values[col];
    if (v === null || v === undefined || String(v).trim() === '') continue;
    const params = [v];
    let sql = `SELECT 1 FROM ${cfg.table} WHERE ${col} = @p0 AND flag_deleted = 0`;
    if (skipId != null) { sql += ` AND ${cfg.pk} <> @p1`; params.push(skipId); }
    // eslint-disable-next-line no-await-in-loop
    const dup = await db.query(sql, params);
    if (dup.length) return `${cfg.label} with this ${col} already exists`;
  }
  return null;
}

/** SQL Server unique-constraint / duplicate-key violation (2627 / 2601). */
function isUniqueViolation(ex) {
  const num = ex && (ex.number != null ? ex.number : (ex.originalError && ex.originalError.info && ex.originalError.info.number));
  return num === 2627 || num === 2601;
}

module.exports = {
  moduleKey, // exported for the route's permission middleware

  async list(req, res) {
    try {
      const cfg = getCfg(res, req.params.key);
      if (!cfg) return;
      const page = Math.max(1, int(req.query.page, 1));
      const per = Math.min(100, Math.max(1, int(req.query.per_page, 20)));
      const search = String(req.query.search || '').trim();

      let where = 'flag_deleted = 0';
      const p = {};
      if (req.query.active === '1') where += ' AND is_active = 1';
      if (search && cfg.search.length) {
        where += ' AND (' + cfg.search.map((c) => `${c} LIKE @search`).join(' OR ') + ')';
        p.search = '%' + search + '%';
      }
      p.off = (page - 1) * per;
      p.lim = per;

      const rows = await db.queryNamed(
        `SELECT * FROM ${cfg.table} WHERE ${where} ORDER BY ${cfg.pk} DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
        p,
      );
      const cnt = await db.queryNamed(`SELECT COUNT(*) AS total FROM ${cfg.table} WHERE ${where}`, p);
      const total = cnt[0] ? cnt[0].total : 0;
      return R.paginated(res, cfg.label + ' list', rows, {
        page, per_page: per, total, total_pages: Math.ceil(total / per) || 1,
      });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async getById(req, res) {
    try {
      const cfg = getCfg(res, req.params.key);
      if (!cfg) return;
      const rows = await db.query(
        `SELECT * FROM ${cfg.table} WHERE ${cfg.pk} = @p0 AND flag_deleted = 0`,
        [int(req.params.id, -1)],
      );
      if (!rows.length) return R.notFound(res, cfg.label + ' not found');
      return R.ok(res, cfg.label, rows[0]);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async create(req, res) {
    try {
      const cfg = getCfg(res, req.params.key);
      if (!cfg) return;
      const auto = cfg.autoCode || null;
      if (auto) req.body[auto.field] = await nextCode(cfg); // server owns the code; ignore any client value
      const { ok, errors, values } = validate(req.body, cfg);
      if (!ok) return R.badRequest(res, 'Validation Error', errors);

      const dupMsg = await duplicateOf(cfg, values, null);
      if (dupMsg) return R.badRequest(res, dupMsg);

      const cols = Object.keys(values).filter((k) => values[k] !== undefined);
      cols.push('created_by');
      const ph = cols.map((_, i) => '@p' + i).join(', ');
      const sql = `INSERT INTO ${cfg.table} (${cols.join(', ')}) OUTPUT INSERTED.${cfg.pk} AS id VALUES (${ph})`;
      const buildParams = () => cols.map((c) => (c === 'created_by' ? (req.userData ? req.userData.userId : null) : values[c]));
      let out;
      for (let attempt = 0; ; attempt++) {
        try {
          out = await db.query(sql, buildParams());
          break;
        } catch (ex) {
          if (auto && isUniqueViolation(ex) && attempt < 5) {
            values[auto.field] = await nextCode(cfg); // lost a race for that number — take the next one
            continue;
          }
          throw ex;
        }
      }
      const id = out[0].id;
      await audit.write(audit.fromReq(req, { action: 'MASTER_CREATE', moduleKey: moduleKey(req.params.key), entityName: cfg.table, entityId: id }));
      return R.created(res, cfg.label + ' created', { id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async update(req, res) {
    try {
      const cfg = getCfg(res, req.params.key);
      if (!cfg) return;
      const id = int(req.params.id, -1);
      const exists = await db.query(`SELECT 1 FROM ${cfg.table} WHERE ${cfg.pk} = @p0 AND flag_deleted = 0`, [id]);
      if (!exists.length) return R.notFound(res, cfg.label + ' not found');

      const { ok, errors, values } = validate(req.body, cfg);
      if (!ok) return R.badRequest(res, 'Validation Error', errors);

      if (cfg.autoCode) delete values[cfg.autoCode.field]; // business code is immutable once assigned

      const dupMsg = await duplicateOf(cfg, values, id);
      if (dupMsg) return R.badRequest(res, dupMsg);

      const cols = Object.keys(values).filter((k) => values[k] !== undefined);
      const setSql = cols.map((c, i) => `${c} = @p${i}`).join(', ');
      const params = cols.map((c) => values[c]);
      params.push(req.userData ? req.userData.userId : null); // updated_by
      params.push(id);
      const ubIdx = cols.length;
      const idIdx = cols.length + 1;
      await db.query(
        `UPDATE ${cfg.table} SET ${setSql}, updated_by = @p${ubIdx}, updated_at = SYSUTCDATETIME() WHERE ${cfg.pk} = @p${idIdx}`,
        params,
      );
      await audit.write(audit.fromReq(req, { action: 'MASTER_UPDATE', moduleKey: moduleKey(req.params.key), entityName: cfg.table, entityId: id }));
      return R.ok(res, cfg.label + ' updated', { id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /** Logical delete: deactivate (is_active=0). Never a physical DELETE. */
  async deactivate(req, res) {
    try {
      const cfg = getCfg(res, req.params.key);
      if (!cfg) return;
      const id = int(req.params.id, -1);
      const active = req.body && req.body.is_active === true ? 1 : 0; // allow reactivate via body
      await db.query(
        `UPDATE ${cfg.table} SET is_active = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE ${cfg.pk} = @p0 AND flag_deleted = 0`,
        [id, active, req.userData ? req.userData.userId : null],
      );
      await audit.write(audit.fromReq(req, { action: active ? 'MASTER_ACTIVATE' : 'MASTER_DEACTIVATE', moduleKey: moduleKey(req.params.key), entityName: cfg.table, entityId: id }));
      return R.ok(res, cfg.label + (active ? ' activated' : ' deactivated'), { id, is_active: active });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /**
   * Delete (client 26-10-2026): removes the record from the master list and every
   * dropdown. Still a logical delete (flag_deleted=1) so records that already use it
   * keep their reference; it cannot be reactivated from the screen.
   */
  async remove(req, res) {
    try {
      const cfg = getCfg(res, req.params.key);
      if (!cfg) return;
      const id = int(req.params.id, -1);
      const rows = await db.query(
        `UPDATE ${cfg.table} SET flag_deleted = 1, is_active = 0, updated_by = @p1, updated_at = SYSUTCDATETIME()
         OUTPUT inserted.${cfg.pk} AS id WHERE ${cfg.pk} = @p0 AND flag_deleted = 0`,
        [id, req.userData ? req.userData.userId : null],
      );
      if (!rows.length) return R.notFound(res, cfg.label + ' not found');
      await audit.write(audit.fromReq(req, { action: 'MASTER_DELETE', moduleKey: moduleKey(req.params.key), entityName: cfg.table, entityId: id }));
      return R.ok(res, cfg.label + ' deleted', { id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
};
