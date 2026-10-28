'use strict';

/**
 * User management (Doc-03: Users). Real implementation.
 *  - list / getById / create / update / remove (soft delete)
 *  - assignRoles: multi-role support via user_roles (first = primary workspace)
 * Passwords hashed with bcrypt. All replies use the uniform response format.
 */

const bcrypt = require('bcryptjs');
const db = require('../config/database');
const T = require('./common/table.controller');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const audit = require('../services/audit.service');
const { check } = require('../utils/validate');
const { NAME, passwordProblem } = require('../utils/validators');

async function rolesOf(userId) {
  return db.query(
    `SELECT r.role_id, r.role_name, ur.is_primary
       FROM ${T.TBL_USER_ROLES} ur JOIN ${T.TBL_ROLES} r ON r.role_id = ur.role_id
      WHERE ur.user_id = @p0 AND r.flag_deleted = 0
      ORDER BY ur.is_primary DESC, r.role_id`,
    [userId]
  );
}

// System Administrator role_id (stable; cannot be deleted) drives the super-admin bypass.
const SUPER_ADMIN_ROLE_ID = 1;

/** Replace a user's role set. roleIds[0] becomes the primary workspace. */
async function setUserRoles(userId, roleIds) {
  await db.query(`DELETE FROM ${T.TBL_USER_ROLES} WHERE user_id = @p0`, [userId]);
  for (let i = 0; i < roleIds.length; i++) {
    await db.query(
      `IF EXISTS (SELECT 1 FROM ${T.TBL_ROLES} WHERE role_id = @p1 AND flag_deleted = 0)
         INSERT INTO ${T.TBL_USER_ROLES} (user_id, role_id, is_primary) VALUES (@p0, @p1, @p2)`,
      [userId, Number(roleIds[i]), i === 0 ? 1 : 0]
    );
  }
  // Assigning/removing System Administrator keeps users.is_super_admin in sync,
  // so the underwriting (and other) super-admin bypass works without a manual DB edit.
  const isSuper = roleIds.map(Number).includes(SUPER_ADMIN_ROLE_ID) ? 1 : 0;
  await db.query(`UPDATE ${T.TBL_USERS} SET is_super_admin = @p1 WHERE user_id = @p0`, [userId, isSuper]);
}

module.exports = {
  async list(req, res) {
    try {
      const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
      const page = Math.max(1, int(req.query.page, 1));
      const per = Math.min(100, Math.max(1, int(req.query.per_page, 20)));
      const search = String(req.query.search || '').trim();

      let where = 'u.flag_deleted = 0';
      const p = {};
      if (req.query.active === '1') where += ' AND u.is_active = 1';
      if (search) {
        where += ' AND (u.email LIKE @search OR u.full_name LIKE @search OR u.phone LIKE @search)';
        p.search = '%' + search + '%';
      }
      const roleId = int(req.query.role_id, 0);
      if (roleId) {
        where += ` AND EXISTS (SELECT 1 FROM ${T.TBL_USER_ROLES} urf WHERE urf.user_id = u.user_id AND urf.role_id = @role_id)`;
        p.role_id = roleId;
      }
      p.off = (page - 1) * per;
      p.lim = per;

      const rows = await db.queryNamed(
        `SELECT u.user_id, u.email, u.full_name, u.role_id, u.branch_id, u.phone,
                u.is_active, u.is_super_admin, u.created_at,
                (SELECT STRING_AGG(r.role_name, ', ')
                   FROM ${T.TBL_USER_ROLES} ur2 JOIN ${T.TBL_ROLES} r ON r.role_id = ur2.role_id
                  WHERE ur2.user_id = u.user_id AND r.flag_deleted = 0) AS roles_text
           FROM ${T.TBL_USERS} u
          WHERE ${where}
          ORDER BY u.user_id DESC
          OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
        p,
      );
      const cnt = await db.queryNamed(`SELECT COUNT(*) AS total FROM ${T.TBL_USERS} u WHERE ${where}`, p);
      const total = cnt[0] ? cnt[0].total : 0;
      return R.paginated(res, 'Users', rows, {
        page, per_page: per, total, total_pages: Math.ceil(total / per) || 1,
      });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async getById(req, res) {
    try {
      const id = Number(req.params.id);
      const rows = await db.query(
        `SELECT user_id, email, full_name, role_id, branch_id, phone, is_active, is_super_admin, created_at
           FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!rows.length) return R.notFound(res, 'User not found');
      const user = rows[0];
      user.roles = await rolesOf(id);
      return R.ok(res, 'User', user);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async create(req, res) {
    try {
      const v = check(req.body, {
        email: 'required|email',
        password: 'required',
        full_name: 'required',
      });
      if (!v.ok) return R.badRequest(res, 'Validation Error', v.errors);
      const pwProblem = passwordProblem(req.body.password);
      if (pwProblem) return R.badRequest(res, 'Validation Error', { password: [pwProblem] });
      if (!NAME.test(String(req.body.full_name).trim())) {
        return R.badRequest(res, 'Validation Error', { full_name: ['Only letters, spaces, . \' and - are allowed (no numbers or special characters)'] });
      }

      const email = String(req.body.email).toLowerCase().trim();
      const dup = await db.query(
        `SELECT 1 FROM ${T.TBL_USERS} WHERE email = @p0 AND flag_deleted = 0`,
        [email]
      );
      if (dup.length) return R.badRequest(res, 'Email already in use');

      const hash = await bcrypt.hash(String(req.body.password), 10);
      const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds.map(Number) : [];
      const primaryRole = roleIds.length ? roleIds[0] : (req.body.role_id ? Number(req.body.role_id) : null);

      const inserted = await db.query(
        `INSERT INTO ${T.TBL_USERS} (email, password_hash, full_name, role_id, branch_id, phone, created_by)
         OUTPUT INSERTED.user_id
         VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)`,
        [
          email, hash, String(req.body.full_name), primaryRole,
          req.body.branch_id != null ? Number(req.body.branch_id) : null,
          req.body.phone ?? null,
          req.userData ? req.userData.userId : null,
        ]
      );
      const userId = inserted[0].user_id;
      if (roleIds.length) await setUserRoles(userId, roleIds);

      return R.created(res, 'User created', { userId });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      const exists = await db.query(
        `SELECT user_id, email, is_active, is_super_admin FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!exists.length) return R.notFound(res, 'User not found');
      const current = exists[0];

      // Email is editable: validate + keep unique among NON-deleted users.
      let newEmail = null;
      if (req.body.email != null && String(req.body.email).trim() !== '') {
        const ve = check({ email: String(req.body.email).trim() }, { email: 'required|email' });
        if (!ve.ok) return R.badRequest(res, 'Validation Error', { email: ['Enter a valid email address.'] });
        newEmail = String(req.body.email).toLowerCase().trim();
        if (newEmail !== String(current.email).toLowerCase()) {
          const dup = await db.query(
            `SELECT 1 FROM ${T.TBL_USERS} WHERE email = @p0 AND flag_deleted = 0 AND user_id <> @p1`,
            [newEmail, id]
          );
          if (dup.length) return R.badRequest(res, 'Validation Error', { email: ['Email already in use.'] });
        } else {
          newEmail = null; // unchanged
        }
      }

      const isSelf = req.userData && Number(req.userData.userId) === id;
      if (req.body.is_active != null && !req.body.is_active && isSelf) {
        return R.badRequest(res, 'You cannot deactivate your own account.');
      }
      if (req.body.full_name != null && req.body.full_name !== '' && !NAME.test(String(req.body.full_name).trim())) {
        return R.badRequest(res, 'Validation Error', { full_name: ['Only letters, spaces, . \' and - are allowed (no numbers or special characters)'] });
      }

      await db.query(
        `UPDATE ${T.TBL_USERS}
            SET full_name = COALESCE(@p1, full_name),
                email     = COALESCE(@p6, email),
                phone     = COALESCE(@p2, phone),
                branch_id = COALESCE(@p3, branch_id),
                is_active = COALESCE(@p4, is_active),
                updated_by = @p5,
                updated_at = SYSUTCDATETIME()
          WHERE user_id = @p0`,
        [
          id,
          req.body.full_name ?? null,
          req.body.phone ?? null,
          req.body.branch_id != null ? Number(req.body.branch_id) : null,
          req.body.is_active != null ? (req.body.is_active ? 1 : 0) : null,
          req.userData ? req.userData.userId : null,
          newEmail,
        ]
      );

      if (Array.isArray(req.body.roleIds)) await setUserRoles(id, req.body.roleIds.map(Number));

      // Deactivated => kill live sessions so they can't refresh back in.
      const wasActive = current.is_active === true || current.is_active === 1;
      if (req.body.is_active != null && !req.body.is_active && wasActive) {
        await db.query(`UPDATE ${T.TBL_REFRESH_TOKENS} SET revoked = 1 WHERE user_id = @p0 AND revoked = 0`, [id]);
        await audit.write(audit.fromReq(req, { action: 'USER_DEACTIVATE', moduleKey: 'USER', entityName: 'users', entityId: id }));
      }
      if (newEmail) {
        await audit.write(audit.fromReq(req, { action: 'USER_EMAIL_CHANGE', moduleKey: 'USER', entityName: 'users', entityId: id, details: { from: current.email, to: newEmail } }));
      }

      return R.ok(res, 'User updated', { userId: id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /**
   * POST /user/:id/password — admin sets a new password for a user (client 26-10-2026).
   * Same password policy as create / reset-password (utils/validators passwordProblem). Signs the user out everywhere and
   * retires pending reset links. Only a System Administrator may change another
   * System Administrator's password.
   */
  async changePassword(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return R.badRequest(res, 'Invalid user id');
      const password = String((req.body && req.body.password) || '');
      const confirm = req.body && req.body.confirmPassword;
      const problem = passwordProblem(password);
      if (problem) return R.badRequest(res, 'Validation Error', { password: [problem] });
      if (confirm != null && String(confirm) !== password) {
        return R.badRequest(res, 'Validation Error', { confirmPassword: ['Passwords do not match.'] });
      }

      const rows = await db.query(
        `SELECT user_id, is_super_admin FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!rows.length) return R.notFound(res, 'User not found');
      const targetSuper = rows[0].is_super_admin === true || rows[0].is_super_admin === 1;
      if (targetSuper && !(req.userData && req.userData.isSuperAdmin)) {
        return R.forbidden(res, 'Only a System Administrator can change this password.');
      }

      const hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE ${T.TBL_USERS} SET password_hash = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
          WHERE user_id = @p0 AND flag_deleted = 0`,
        [id, hash, req.userData ? req.userData.userId : null]
      );
      // Sign out every existing session of that user (not the admin's own current one) + retire reset links.
      const isSelf = req.userData && Number(req.userData.userId) === id;
      if (!isSelf) await db.query(`UPDATE ${T.TBL_REFRESH_TOKENS} SET revoked = 1 WHERE user_id = @p0 AND revoked = 0`, [id]);
      await db.query(
        `UPDATE ${T.TBL_PASSWORD_RESETS} SET consumed = 1, consumed_at = SYSUTCDATETIME() WHERE user_id = @p0 AND consumed = 0`,
        [id]
      );
      await audit.write(audit.fromReq(req, { action: 'USER_PASSWORD_CHANGE', moduleKey: 'USER', entityName: 'users', entityId: id }));
      return R.ok(res, 'Password changed', { userId: id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /**
   * DELETE /user/:id — SOFT delete. Sets flag_deleted = 1 (+ is_active = 0,
   * deleted_on, deleted_by). Deleted users disappear from the list and every
   * auth path filters flag_deleted = 0, so they can no longer sign in.
   */
  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return R.badRequest(res, 'Invalid user id');
      const rows = await db.query(
        `SELECT user_id, is_super_admin FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!rows.length) return R.notFound(res, 'User not found');
      if (req.userData && Number(req.userData.userId) === id) {
        return R.badRequest(res, 'You cannot delete your own account.');
      }
      if (rows[0].is_super_admin === true || rows[0].is_super_admin === 1) {
        return R.badRequest(res, 'System Administrator account cannot be deleted.');
      }

      await db.query(
        `UPDATE ${T.TBL_USERS}
            SET flag_deleted = 1, is_active = 0,
                deleted_on = SYSUTCDATETIME(), deleted_by = @p1,
                updated_by = @p1, updated_at = SYSUTCDATETIME()
          WHERE user_id = @p0 AND flag_deleted = 0`,
        [id, req.userData ? req.userData.userId : null]
      );
      // End live sessions + pending reset links for the deleted user.
      await db.query(`UPDATE ${T.TBL_REFRESH_TOKENS} SET revoked = 1 WHERE user_id = @p0 AND revoked = 0`, [id]);
      await db.query(
        `UPDATE ${T.TBL_PASSWORD_RESETS} SET consumed = 1, consumed_at = SYSUTCDATETIME() WHERE user_id = @p0 AND consumed = 0`,
        [id]
      );
      await audit.write(audit.fromReq(req, { action: 'USER_DELETE', moduleKey: 'USER', entityName: 'users', entityId: id }));
      return R.ok(res, 'User deleted', { userId: id });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  /** POST /user/:id/roles  { roleIds: [..] } */
  async assignRoles(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Array.isArray(req.body.roleIds)) return R.badRequest(res, 'roleIds array required');
      const exists = await db.query(
        `SELECT 1 FROM ${T.TBL_USERS} WHERE user_id = @p0 AND flag_deleted = 0`,
        [id]
      );
      if (!exists.length) return R.notFound(res, 'User not found');
      await setUserRoles(id, req.body.roleIds.map(Number));
      // keep users.role_id in sync with the primary role
      const primary = req.body.roleIds.length ? Number(req.body.roleIds[0]) : null;
      await db.query(`UPDATE ${T.TBL_USERS} SET role_id = @p1 WHERE user_id = @p0`, [id, primary]);
      await audit.write(audit.fromReq(req, { action: 'ROLE_ASSIGN', moduleKey: 'USER', entityName: 'users', entityId: id, details: { roleIds: req.body.roleIds } }));
      return R.ok(res, 'Roles assigned', { userId: id, roles: await rolesOf(id) });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
};
