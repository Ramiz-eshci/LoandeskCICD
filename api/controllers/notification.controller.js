'use strict';

/**
 * Notifications controller — the bell feed for the CURRENT user.
 * Personal data: every action is scoped to req.userData.userId. No module
 * permission gate (a user always sees their own notifications).
 */

const R = require('../services/response.service');
const Logs = require('./common/logs.controller');
const svc = require('../services/notification.service');

module.exports = {
  async list(req, res) {
    try {
      const unreadOnly = String(req.query.unread || '') === '1';
      const limit = Number(req.query.limit) || 30;
      const rows = await svc.listForUser(req.userData.userId, { unreadOnly, limit });
      return R.ok(res, 'Notifications', rows);
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async unreadCount(req, res) {
    try {
      return R.ok(res, 'Unread count', { count: await svc.unreadCount(req.userData.userId) });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async markRead(req, res) {
    try {
      await svc.markRead(Number(req.params.id), req.userData.userId);
      return R.ok(res, 'Marked read', { id: Number(req.params.id) });
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },

  async markAllRead(req, res) {
    try {
      await svc.markAllRead(req.userData.userId);
      return R.ok(res, 'All marked read', {});
    } catch (ex) { Logs.ErrorHandler(ex, res, req); }
  },
};
