'use strict';

/**
 * Shared text input rules (client 15-10-2026: a director named "SELECT * FROM users" was
 * accepted - special characters must be refused across the application).
 *
 *  PERSON_NAME  people's names: letters (incl. accented), spaces, . ' -
 *  UNSAFE       characters no name / address / short text field needs and that are typical
 *               of code / script / SQL injection: < > * ; = ` { } [ ] \ | ^ ~ $
 * Long free-text notes are NOT checked (staff may legitimately type "=" or "*" there).
 */
const PERSON_NAME = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'\-]*$/;
const UNSAFE = /[<>*;=`{}[\]\\|^~$]/;

const NAME_MSG = "Use letters, spaces and . ' - only";
const UNSAFE_MSG = 'Special characters < > * ; = ` { } [ ] \\ | ^ ~ $ are not allowed';

/** Error message for a value, or null when fine. `kind` = 'name' | 'text'. */
function textError(value, kind = 'text') {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (kind === 'name') return PERSON_NAME.test(v) ? null : NAME_MSG;
  return UNSAFE.test(v) ? UNSAFE_MSG : null;
}

module.exports = { PERSON_NAME, UNSAFE, NAME_MSG, UNSAFE_MSG, textError };
