'use strict';

/** Shared validation regexes (server side; mirror front/masters.config.ts VALIDATION). */
module.exports = {
  // People / role names: must start with a letter; letters, spaces, . ' - only. No digits, no special.
  NAME: /^[A-Za-z][A-Za-z .'-]*$/,
  // Free text (address, description, company): letters/digits/space + . , & / ' ( ) - . Blocks other specials.
  TEXT: /^[A-Za-z0-9 .,&/'()-]+$/,
  CODE: /^[A-Za-z0-9_-]+$/,
  PHONE: /^[0-9+()\-\s]+$/,
  EMAIL: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
};

/**
 * Password policy (client 26-10-2026) - user create, admin change password, reset password.
 * 8-128 chars with at least one upper case, one lower case, one digit and one special
 * character. Mirrors front/core/validators/password.validator.ts. Returns the first
 * problem as a message, or null when the password is fine.
 */
module.exports.passwordProblem = function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Z]/.test(p)) return 'Password must contain at least one upper case letter.';
  if (!/[a-z]/.test(p)) return 'Password must contain at least one lower case letter.';
  if (!/[0-9]/.test(p)) return 'Password must contain at least one digit.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must contain at least one special character.';
  return null;
};
