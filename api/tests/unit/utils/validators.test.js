'use strict';

const V = require('../../../utils/validators');

describe('utils/validators regexes', () => {
  it('NAME: letters, spaces, . \' - starting with a letter; no digits', () => {
    expect(V.NAME.test('John')).toBe(true);
    expect(V.NAME.test("O'Brien-Smith")).toBe(true);
    expect(V.NAME.test('John2')).toBe(false);
    expect(V.NAME.test('2John')).toBe(false);
    expect(V.NAME.test('')).toBe(false);
  });

  it('TEXT: free text with limited punctuation, blocks other specials', () => {
    expect(V.TEXT.test('10 High St, Apt (3) & more')).toBe(true);
    expect(V.TEXT.test('bad <script>')).toBe(false);
  });

  it('CODE: alphanumeric, underscore, dash only', () => {
    expect(V.CODE.test('ABC_12-3')).toBe(true);
    expect(V.CODE.test('has space')).toBe(false);
  });

  it('PHONE: digits, +, (), -, spaces', () => {
    expect(V.PHONE.test('+44 (0)7700 900000')).toBe(true);
    expect(V.PHONE.test('07700-900000')).toBe(true);
    expect(V.PHONE.test('phone')).toBe(false);
  });

  it('EMAIL: simple local@domain.tld', () => {
    expect(V.EMAIL.test('a@b.com')).toBe(true);
    expect(V.EMAIL.test('a.b@c.co.uk')).toBe(true);
    expect(V.EMAIL.test('no-at')).toBe(false);
    expect(V.EMAIL.test('a@b')).toBe(false);
  });
});
