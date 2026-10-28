'use strict';

/**
 * Backward-compat shim. The JWT auth middleware now lives in
 * middlewares/authenticate.js. Old code that did
 *   const checkAuth = require('../config/auth')
 * keeps working through this re-export.
 */
module.exports = require('../middlewares/authenticate');
