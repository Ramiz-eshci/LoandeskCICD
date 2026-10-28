'use strict';

/** Jest config for the LoanDesk API (CommonJS, node env). */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  clearMocks: true,
  collectCoverageFrom: [
    'controllers/**/*.js',
    'middlewares/**/*.js',
    'utils/**/*.js',
    'services/**/*.js',
  ],
  // don't hang the run if a stray handle (pool/timer) stays open
  forceExit: true,
};
