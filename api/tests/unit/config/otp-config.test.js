'use strict';

/**
 * Pen-test fix (24-10-2026): OTP configuration defaults + boot warnings.
 * dotenv is stubbed so the developer's local .env cannot influence the result.
 */

const KEYS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SECRET_KEY', 'DB_NAME', 'ENCRYPTION_ENABLED', 'NODE_ENV', 'OTP_DEFAULT_ENABLED', 'OTP_DEFAULT_CODE', 'IS_LOGIN_OTP_SENT_EMAIL', 'IS_LOGIN_OTP_SENT_MOBILE', 'CORS_ORIGINS'];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/** Load config/env.js fresh with exactly these variables (and no .env file). */
function load(env) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let mod;
  jest.isolateModules(() => {
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    mod = require('../../../config/env');
  });
  return mod;
}

describe('OTP defaults', () => {
  it('production without OTP settings: real codes, no fallback code', () => {
    const { config } = load({ NODE_ENV: 'production' });
    expect(config.otp.defaultEnabled).toBe(false);
    expect(config.otp.defaultCode).toBe('');
  });

  it('development without OTP settings keeps the fixed 123456 for convenience', () => {
    const { config } = load({ NODE_ENV: 'development' });
    expect(config.otp.defaultEnabled).toBe(true);
    expect(config.otp.defaultCode).toBe('123456');
  });

  it('explicit .env values still win', () => {
    const { config } = load({ NODE_ENV: 'production', OTP_DEFAULT_ENABLED: 'true', OTP_DEFAULT_CODE: '654321' });
    expect(config.otp.defaultEnabled).toBe(true);
    expect(config.otp.defaultCode).toBe('654321');
  });
});

describe('boot warnings (production)', () => {
  let warn;
  let exit;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const base = {
    NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com', DB_NAME: 'loandesk', ENCRYPTION_ENABLED: 'false',
    JWT_SECRET: 'j'.repeat(64), JWT_REFRESH_SECRET: 'r'.repeat(64), SECRET_KEY: 's'.repeat(64),
  };
  const warned = (re) => warn.mock.calls.some((c) => re.test(String(c[0])));

  it('warns (but keeps running) when the fixed OTP is on in production', () => {
    load({ ...base, OTP_DEFAULT_ENABLED: 'true', OTP_DEFAULT_CODE: '111111' }).validate();
    expect(warned(/OTP_DEFAULT_ENABLED=true/)).toBe(true);
  });

  it('warns when real OTP is on but no delivery channel is enabled', () => {
    load({ ...base, OTP_DEFAULT_ENABLED: 'false', IS_LOGIN_OTP_SENT_EMAIL: 'false', IS_LOGIN_OTP_SENT_MOBILE: 'false' }).validate();
    expect(warned(/nobody can receive a login code/)).toBe(true);
  });

  it('no OTP warning for real codes delivered by e-mail', () => {
    load({ ...base, OTP_DEFAULT_ENABLED: 'false', IS_LOGIN_OTP_SENT_EMAIL: 'true' }).validate();
    expect(warned(/SECURITY WARNING/)).toBe(false);
  });

  it('the OTP warning never aborts the boot by itself', () => {
    load({ ...base, OTP_DEFAULT_ENABLED: 'true', OTP_DEFAULT_CODE: '1' }).validate();
    expect(warned(/OTP_DEFAULT_ENABLED=true/)).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });
});
