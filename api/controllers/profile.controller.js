'use strict';

/**
 * My Profile (client 26-10-2026) - header menu "Profile & preferences".
 * Every action works on the SIGNED-IN user only (req.userData.userId), never an id
 * from the request, so no RBAC permission is needed.
 *   GET  /auth/profile            name, email, phone, branch, roles, avatar
 *   PUT  /auth/profile            full_name, phone
 *   POST /auth/profile/password   currentPassword + new password (password policy)
 *   PUT  /auth/profile/avatar     { avatar: data URL | null }
 * Passwords are bcrypt hashes - nobody (not even a System Administrator) can read one;
 * an admin can only SET a new one (Users > Edit > Change Password).
 */

const bcrypt = require('bcryptjs');
const db = require('../config/database');
const T = require('./common/table.controller');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const audit = require('../services/audit.service');
const { NAME, PHONE, passwordProblem } = require('../utils/validators');

// Only raster images (no SVG: it can carry script). Max ~300 KB decoded - the page resizes to 256px first.
const AVATAR_RX = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const AVATAR_MAX_BYTES = 300 * 1024;
const MAGIC = {
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

/** null when the data URL is a real png / jpeg / webp within the size limit, else a message. */
function avatarProblem(v) {
  const m = AVATAR_RX.exec(String(v || ''));
  if (!m) return 'Upload a PNG, JPG or WEBP image.';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > AVATAR_MAX_BYTES) return 'The image is too large (max 300 KB).';
  if (!MAGIC[m[1]](buf)) return 'The file is not a valid image.';
  return null;
}

const uid = (req) => Number(req.userData && req.userData.userId);

async function load(id) {
  const rows = await db.query(
    `SELECT u.user_id, u.email, u.full_name, u.phone, u.avatar, b.branch_name
       FROM ${T.TBL_USERS} u
       LEFT JOIN branches b ON b.branch_id = u.branch_id
      WHERE u.user_id = @p0 AND u.flag_deleted = 0`,
    [id],
  );
  if (!rows.length) return null;
  const roles = await db.query(
    `SELECT r.role_name FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id AND r.flag_deleted = 0
      WHERE ur.user_id = @p0 ORDER BY r.role_name`,
    [id],
  ).catch(() => []);
  const u = rows[0];
  return {
    userId: u.user_id, email: u.email, fullName: u.full_name, phone: u.phone,
    branchName: u.branch_name || null, avatar: u.avatar || null, roles: roles.map((r) => r.role_name),
  };
}

module.exports = {
  avatarProblem,

  async get(req, res) {
    try {
      const out = await load(uid(req));
      if (!out) return R.notFound(res, 'User not found');
      return R.ok(res, 'Profile', out);
    } catch (ex) { Logs.ErrorHandler(ex, res); }
  },

  async update(req, res) {
    try {
      const name = String((req.body && req.body.full_name) || '').trim();
      const phone = String((req.body && req.body.phone) || '').trim();
      const errors = {};
      if (!name) errors.full_name = ['Full name is required.'];
      else if (name.length > 150 || !NAME.test(name)) errors.full_name = ["Only letters, spaces, . ' and - are allowed (no numbers or special characters)"];
      if (phone && (phone.length > 30 || !PHONE.test(phone))) errors.phone = ['Enter a valid phone number.'];
      if (Object.keys(errors).length) return R.badRequest(res, 'Validation Error', errors);

      await db.query(
        `UPDATE ${T.TBL_USERS} SET full_name = @p1, phone = @p2, updated_by = @p0, updated_at = SYSUTCDATETIME()
          WHERE user_id = @p0 AND flag_deleted = 0`,
        [uid(req), name, phone || null],
      );
      await audit.write(audit.fromReq(req, { action: 'PROFILE_UPDATE', moduleKey: 'USER', entityName: 'users', entityId: uid(req) }));
      return R.ok(res, 'Profile updated', await load(uid(req)));
    } catch (ex) { Logs.ErrorHandler(ex, res); }
  },

  async changePassword(req, res) {
    try {
      const b = req.body || {};
      const current = String(b.currentPassword || '');
      const password = String(b.password || '');
      if (!current) return R.badRequest(res, 'Validation Error', { currentPassword: ['Enter your current password.'] });
      const problem = passwordProblem(password);
      if (problem) return R.badRequest(res, 'Validation Error', { password: [problem] });
      if (b.confirmPassword != null && String(b.confirmPassword) !== password) {
        return R.badRequest(res, 'Validation Error', { confirmPassword: ['Passwords do not match.'] });
      }
      if (current === password) return R.badRequest(res, 'Validation Error', { password: ['The new password must be different from the current one.'] });

      const rows = await db.query(`SELECT password_hash FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0`, [uid(req)]);
      if (!rows.length) return R.notFound(res, 'User not found');
      if (!(await bcrypt.compare(current, rows[0].password_hash || ''))) {
        return R.badRequest(res, 'Validation Error', { currentPassword: ['Current password is incorrect.'] });
      }

      const hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE ${T.TBL_USERS} SET password_hash = @p1, updated_by = @p0, updated_at = SYSUTCDATETIME() WHERE user_id = @p0`,
        [uid(req), hash],
      );
      // Retire any pending "forgot password" links.
      await db.query(
        `UPDATE ${T.TBL_PASSWORD_RESETS} SET consumed = 1, consumed_at = SYSUTCDATETIME() WHERE user_id = @p0 AND consumed = 0`,
        [uid(req)],
      );
      await audit.write(audit.fromReq(req, { action: 'PROFILE_PASSWORD_CHANGE', moduleKey: 'USER', entityName: 'users', entityId: uid(req) }));
      return R.ok(res, 'Password changed', {});
    } catch (ex) { Logs.ErrorHandler(ex, res); }
  },

  async setAvatar(req, res) {
    try {
      const v = req.body ? req.body.avatar : null;
      if (v !== null && v !== '') {
        const problem = avatarProblem(v);
        if (problem) return R.badRequest(res, 'Validation Error', { avatar: [problem] });
      }
      await db.query(
        `UPDATE ${T.TBL_USERS} SET avatar = @p1, updated_by = @p0, updated_at = SYSUTCDATETIME() WHERE user_id = @p0 AND flag_deleted = 0`,
        [uid(req), v || null],
      );
      await audit.write(audit.fromReq(req, { action: v ? 'PROFILE_AVATAR_SET' : 'PROFILE_AVATAR_REMOVE', moduleKey: 'USER', entityName: 'users', entityId: uid(req) }));
      return R.ok(res, v ? 'Profile picture updated' : 'Profile picture removed', { avatar: v || null });
    } catch (ex) { Logs.ErrorHandler(ex, res); }
  },
};
