'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('../controllers/crypto.controller');

router.get('/public-key', crypto.publicKey);
router.post('/session', crypto.createSession);
router.get('/session/validate', crypto.validateSession);

module.exports = router;
