'use strict';

/**
 * Block content edits on an application that has reached a locked stage
 * (APPROVED onward — see config/application.config.js LOCKED_STATUSES).
 * Status MOVES are NOT blocked here (managers still progress/decline via the
 * /status route + TRANSITIONS). Super admins bypass. 404 if the app is missing.
 */

const db = require('../config/database');
const CFG = require('../config/application.config');
const R = require('../services/response.service');

const LOCKED = new Set(CFG.LOCKED_STATUSES || []);

module.exports.requireUnlocked = async function (req, res, next) {
  try {
    if (req.userData && req.userData.isSuperAdmin) return next();
    const id = Number(req.params.id);
    const rows = await db.query(
      `SELECT st.code AS code
         FROM applications a
         LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
        WHERE a.application_id = @p0 AND a.flag_deleted = 0`,
      [id],
    );
    if (!rows.length) return R.notFound(res, 'Application not found');
    const code = String(rows[0].code || '').toUpperCase();
    if (LOCKED.has(code)) {
      return R.forbidden(res, `This application is ${code.toLowerCase()} and can no longer be edited`);
    }
    return next();
  } catch (err) {
    return next(err);
  }
};
