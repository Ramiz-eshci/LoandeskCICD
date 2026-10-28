'use strict';

const service = require('../services/demoRequest.service');
const R = require('../services/response.service');
const logger = require('../utils/logger');

module.exports = {
  async create(req, res) {
    try {
      const result = await service.create(req.body);
      if (!result.ok) return R.badRequest(res, 'Please check your demo request details', result.errors);
      return R.created(res, 'Demo request received', { request_ref: result.request_ref });
    } catch (error) {
      logger.logRequestError(error, req);
      return R.serverError(res, 'Unable to save your demo request. Please try again.');
    }
  },
};
