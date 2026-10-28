'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const ctrl = require('../controllers/dashbord.controller');

/**
 * Dashboard.
 *
 * No requirePermission() here on purpose. The previous route asked for
 * ("DASHBORD", "read") — a module key that does not exist in the live
 * permission catalog (it is DASHBOARD in the old flat seeder, and absent
 * entirely from the granular matrix), and an action "read" that is never
 * seeded either. The effect was a 403 for every non-admin user.
 *
 * Every signed-in user is entitled to a dashboard; what they see inside it is
 * decided tile-by-tile in services/dashboard.service.js against their real
 * module permissions.
 */
router.get('/', authenticate, ctrl.summary);

module.exports = router;
