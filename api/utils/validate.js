'use strict';

/**
 * Minimal request-body validator (pen-test 24-10-2026).
 *
 * Replaces node-input-validator, which pulled in vulnerable image-size / file-type
 * through file rules this API never used. Supports the rules LoanDesk uses -
 * required | email | minLength:N - with the SAME error shape and messages, so API
 * responses and the Angular error display are unchanged:
 *   { field: { message: 'The field name field is mandatory.', rule: 'required' } }
 */

const isEmail = require('validator/lib/isEmail');

/** challengeId -> "challenge id", full_name -> "full name" */
const niceName = (attr) => String(attr).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

const isEmpty = (value, trim) => {
  if (!value && value !== false && value !== 0) return true;
  const s = value.toString();
  return trim ? !s.trim() : !s;
};

const RULES = {
  required: {
    test: (v) => !isEmpty(v, true),
    message: (n) => `The ${n} field is mandatory.`,
  },
  email: {
    test: (v) => isEmail(String(v)),
    message: (n) => `The ${n} must be a valid email address.`,
  },
  minLength: {
    test: (v, arg) => v.toString().length >= parseInt(arg, 10),
    message: (n, arg) => `The ${n} can not be less than ${arg}.`,
  },
};

/**
 * @param {object} body   request body (or any object)
 * @param {Record<string,string>} rules  e.g. { email: 'required|email', password: 'required|minLength:8' }
 * @returns {{ ok: boolean, errors: Record<string, {message:string, rule:string}> }}
 */
function check(body, rules) {
  const errors = {};
  const src = body || {};
  for (const [attr, spec] of Object.entries(rules)) {
    const list = String(spec).split('|').filter(Boolean);
    const value = src[attr];
    const required = list.includes('required');
    if (!required && isEmpty(value, false)) continue; // optional + absent -> nothing to check
    for (const item of list) {
      const [name, arg] = item.split(':');
      const rule = RULES[name];
      if (!rule) throw new Error(`Unknown validation rule "${name}" for ${attr}`);
      if (!rule.test(value, arg)) {
        errors[attr] = { message: rule.message(niceName(attr), arg), rule: name };
        break; // first failing rule per field, like node-input-validator
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

module.exports = { check, niceName };
