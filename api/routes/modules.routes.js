'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const ctrl = require('../controllers/modules.controller');

// Read-only list; any authenticated user can read the module catalog.
router.get('/', authenticate, ctrl.list);

module.exports = router;
