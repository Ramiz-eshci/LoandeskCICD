'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { requirePermission } = require('../middlewares/rbac');
const example = require('../controllers/example.controller');

router.get('/ping', example.ping);
router.post('/echo', example.echo);
router.get('/whoami', authenticate, example.whoami);
router.get('/secure', authenticate, requirePermission('EXAMPLE', 'view'), example.secure);

module.exports = router;
