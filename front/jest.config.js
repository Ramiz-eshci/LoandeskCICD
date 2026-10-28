const { createCjsPreset } = require('jest-preset-angular/presets');

/** Jest config for the LoanDesk Angular client (jest-preset-angular, jsdom). */
module.exports = {
  ...createCjsPreset(),
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.angular/', '/out-tsc/'],
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/**/*.routes.ts',
    '!src/app/**/*.model.ts',
    '!src/app/**/*.data.ts',
    '!src/main.ts',
  ],
};
