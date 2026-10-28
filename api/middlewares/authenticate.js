'use strict';

/**
 * JWT authentication (A07). Verifies the access token from the
 * Authorization: Bearer <token> header and attaches req.userData.
 *
 * NOTE: the old project wrapped the JWT payload in a second AES-256-CBC layer
 * using a server key. That added no real security (the server holds both keys)
 * and is removed. Confidentiality on the wire is provided by HTTPS + the
 * transport-encryption envelope; integrity by the JWT signature itself.
 */

const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const R = require('../services/response.service');

module.exports = function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return R.unauthorized(res, 'Authorization token missing');

    const decoded = jwt.verify(token, config.jwt.secret);
    // decoded already carries server-set fields (see auth.controller signAccessToken)
    req.userData = {
      userId: decoded.userId,
      email: decoded.email,
      roleId: decoded.roleId,
      companyId: decoded.companyId ?? null,
      // admin flags are SERVER-SET booleans, never a client-supplied role name
      isSuperAdmin: decoded.isSuperAdmin === true,
      isCompanyAdmin: decoded.isCompanyAdmin === true,
    };
    return next();
  } catch (err) {
    return R.unauthorized(res, 'Authorization failed');
  }
};
