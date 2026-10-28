'use strict';

const express = require('express');
const { demoRequestLimiter } = require('../middlewares/rate-limit');
const controller = require('../controllers/demoRequest.controller');
const R = require('../services/response.service');

const router = express.Router();

router.post('/', demoRequestLimiter, express.json({ limit: '16kb' }), controller.create);

router.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return R.send(res, 413, false, 'Your demo request is too large');
  if (error.type === 'entity.parse.failed') return R.badRequest(res, 'Send a valid JSON demo request');
  return next(error);
});

module.exports = router;
