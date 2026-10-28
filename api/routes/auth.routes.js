'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const { authLimiter } = require('../middlewares/rate-limit');
const auth = require('../controllers/auth.controller');

// login-type routes get the stricter limiter
router.post('/login', authLimiter, auth.login);
router.post('/verify-otp', authLimiter, auth.verifyOtp);
router.post('/resend-otp', authLimiter, auth.resendOtp);
// forgot-password journey (public, rate-limited)
router.post('/forgot-password', authLimiter, auth.forgotPassword);
router.post('/reset-password/validate', authLimiter, auth.validateResetToken);
router.post('/reset-password', authLimiter, auth.resetPassword);
router.post('/refresh', auth.refresh);
// Pen-test 24-10-2026: POST only - a GET could be fired cross-site (<img src=...>) to log users out.
router.post('/logout', auth.logout);
router.post('/select-role', authenticate, auth.selectRole);
router.get('/me', authenticate, auth.me);

// My Profile (client 26-10-2026): signed-in user's own account only.
const profile = require('../controllers/profile.controller');
router.get('/profile', authenticate, profile.get);
router.put('/profile', authenticate, profile.update);
router.post('/profile/password', authenticate, authLimiter, profile.changePassword);
router.put('/profile/avatar', authenticate, profile.setAvatar);

module.exports = router;
