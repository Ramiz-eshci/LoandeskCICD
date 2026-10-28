'use strict';

/**
 * utils/validate replaced node-input-validator (pen-test 24-10-2026). The error
 * shape and messages are pinned here because the Angular app shows them.
 */

const { check, niceName } = require('../../../utils/validate');

describe('utils/validate.check', () => {
  const LOGIN = { email: 'required|email', password: 'required' };

  it('passes valid input', () => {
    expect(check({ email: 'jane@lender.co.uk', password: 'x' }, LOGIN)).toEqual({ ok: true, errors: {} });
  });

  it('required: missing, blank and whitespace-only values', () => {
    expect(check({}, LOGIN).errors).toEqual({
      email: { message: 'The email field is mandatory.', rule: 'required' },
      password: { message: 'The password field is mandatory.', rule: 'required' },
    });
    expect(check({ email: '   ', password: '' }, LOGIN).ok).toBe(false);
    expect(check({ x: [] }, { x: 'required' }).ok).toBe(false);
  });

  it('required: 0 and false count as present', () => {
    expect(check({ otp: 0, challengeId: false }, { otp: 'required', challengeId: 'required' }).ok).toBe(true);
  });

  it('email: uses validator.isEmail (rejects a@b, trailing spaces, localhost)', () => {
    for (const bad of ['bad', 'a@b', 'a@b.com ', 'a@localhost']) {
      expect(check({ email: bad, password: 'x' }, LOGIN).errors).toEqual({ email: { message: 'The email must be a valid email address.', rule: 'email' } });
    }
    expect(check({ email: 'Jane.Doe+x@sub.example.co.uk', password: 'x' }, LOGIN).ok).toBe(true);
  });

  it('optional rules are skipped for empty values', () => {
    expect(check({ email: '' }, { email: 'email' }).ok).toBe(true);
    expect(check({}, { email: 'email' }).ok).toBe(true);
  });

  it('minLength', () => {
    expect(check({ password: 'short' }, { password: 'required|minLength:8' }).errors)
      .toEqual({ password: { message: 'The password can not be less than 8.', rule: 'minLength' } });
    expect(check({ password: 12345678 }, { password: 'required|minLength:8' }).ok).toBe(true);
  });

  it('reports only the first failing rule per field', () => {
    expect(check({ email: '' }, { email: 'required|email' }).errors.email.rule).toBe('required');
  });

  it('nice field names', () => {
    expect(niceName('challengeId')).toBe('challenge id');
    expect(niceName('full_name')).toBe('full name');
    expect(check({}, { challengeId: 'required' }).errors.challengeId.message).toBe('The challenge id field is mandatory.');
  });

  it('throws on an unknown rule (programming error)', () => {
    expect(() => check({ a: 1 }, { a: 'url' })).toThrow(/Unknown validation rule/);
  });
});
