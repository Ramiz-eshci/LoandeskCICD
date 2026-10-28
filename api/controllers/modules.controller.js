'use strict';

/** Modules master — dynamic module/screen hierarchy (read APIs for the permission matrix + menu). */
const db = require('../config/database');
const T = require('./common/table.controller');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');

module.exports = {
  async list(req, res) {
    try {
      const rows = await db.query(
        `SELECT module_id, module_code, module_name, parent_code, sort_order, icon, route, is_active
           FROM ${T.TBL_MODULES}
          WHERE flag_deleted = 0
          ORDER BY sort_order, module_code`,
      );
      return R.ok(res, 'Modules', rows);
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
};
