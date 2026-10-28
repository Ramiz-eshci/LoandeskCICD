'use strict';

const { textError, NAME_MSG, UNSAFE_MSG } = require('../../../utils/textRules');

describe('textRules.textError', () => {
  it.each(["Jane O'Neil", 'Jean-Luc Picard', 'Zoë Ångström', 'J. R. Smith'])('accepts the name %s', (v) => {
    expect(textError(v, 'name')).toBeNull();
  });

  it.each(['SELECT * FROM users', 'Robert1', '<script>', 'a;b', ' -lead'])('rejects the name %s', (v) => {
    expect(textError(v, 'name')).toBe(NAME_MSG);
  });

  it.each(['10 Downing Street, London', 'Flat 2/1, 3 Main St.', 'Smith & Co (Ltd)'])('accepts the text %s', (v) => {
    expect(textError(v)).toBeNull();
  });

  it.each(['<b>x</b>', "1; DROP TABLE x", 'a=b', '${x}', '`cmd`', 'a|b', 'x*y'])('rejects unsafe text %s', (v) => {
    expect(textError(v, 'text')).toBe(UNSAFE_MSG);
  });

  it('ignores empty values', () => {
    expect(textError(null)).toBeNull();
    expect(textError(undefined, 'name')).toBeNull();
    expect(textError('   ', 'name')).toBeNull();
  });
});
