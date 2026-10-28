'use strict';

/**
 * JSON / form body size limits (pen-test 24-10-2026, DoS).
 *
 * Staff uploads travel as base64 inside JSON (20 MB files, several per request), so a
 * signed-in staff request may be large (UPLOAD_BODY_LIMIT, default 100mb). Requests WITHOUT
 * a token signed by this API (login, OTP, forgot-password, webhooks, crypto handshake ...)
 * never need that, so they get JSON_BODY_LIMIT (default 2mb) - an anonymous client can no
 * longer make the server buffer and parse 100 MB.
 *
 * Only the token SIGNATURE is checked here (expiry ignored): an upload sent with an
 * expired token still gets the large limit and then the normal 401 from authenticate(),
 * so the Angular app refreshes the token and retries instead of seeing "413 too large".
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { config } = require('../config/env');

function signedByUs(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  try {
    jwt.verify(h.slice(7), config.jwt.secret, { ignoreExpiration: true });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = function bodyLimits() {
  const small = config.body.jsonLimit;
  const big = config.body.uploadLimit;
  const json = { small: express.json({ limit: small }), big: express.json({ limit: big }) };
  const form = {
    small: express.urlencoded({ extended: true, limit: small }),
    big: express.urlencoded({ extended: true, limit: big }),
  };
  return [
    (req, res, next) => (signedByUs(req) ? json.big : json.small)(req, res, next),
    (req, res, next) => (signedByUs(req) ? form.big : form.small)(req, res, next),
  ];
};
