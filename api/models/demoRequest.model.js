'use strict';

const common = require('./common');
const { TBL_DEMO_REQUESTS } = require('../controllers/common/table.controller');

module.exports = {
  create(values) {
    return common.insert(TBL_DEMO_REQUESTS, values);
  },
};
