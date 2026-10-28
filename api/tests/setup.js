'use strict';

/**
 * Test env bootstrap - runs before each test file.
 * Force a safe, offline config so importing app.js never needs a real DB,
 * real secrets, or transport encryption.
 */
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_ENABLED = 'false'; // routes don't require X-Session-Id
process.env.JWT_SECRET = 'test_jwt_secret_value';
process.env.JWT_REFRESH_SECRET = 'test_jwt_refresh_secret_value';
process.env.SECRET_KEY = 'test_session_secret_value';
process.env.DB_NAME = 'test_db';
process.env.CORS_ORIGINS = 'http://localhost:4200';
