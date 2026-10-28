'use strict';

const model = require('../models/demoRequest.model');
const { EMAIL } = require('../utils/validators');

const INTERESTS = [
  'Full platform',
  'Enquiries & applications',
  'Underwriting workflow',
  'Portfolio & servicing',
  'Reporting & oversight',
];
const LIMITS = { name: 120, email: 254, company: 160, interest: 80, message: 2000 };

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { form: 'Send a JSON object with your demo request details' } };
  }
  const errors = {};
  const values = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    const raw = body[field];
    if (raw == null && field === 'message') {
      values[field] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      errors[field] = field === 'message' ? 'Enter a text message' : 'This field is required and must be text';
      continue;
    }
    const value = raw.trim();
    values[field] = value || null;
    if (!value && field !== 'message') errors[field] = 'This field is required';
    else if (value.length > max) errors[field] = `Use ${max} characters or fewer`;
    else if ((field === 'message' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) {
      errors[field] = 'Please remove unsupported control characters';
    }
  }
  if (!errors.email && !EMAIL.test(values.email)) errors.email = 'Enter a valid work email';
  if (!errors.interest && !INTERESTS.includes(values.interest)) errors.interest = 'Choose a valid area of interest';
  return { ok: Object.keys(errors).length === 0, errors, values };
}

async function create(body) {
  const result = validate(body);
  if (!result.ok) return result;
  const row = await model.create(result.values);
  if (!row || !row.request_ref) throw new Error('Demo request insert did not return a reference');
  return { ok: true, request_ref: row.request_ref };
}

module.exports = { INTERESTS, validate, create };
