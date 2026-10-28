import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_INTERESTS, validateDemoRequest } from '../src/lib/demo.ts';

const request = {
  name: ' Jane Smith ',
  email: ' jane@firm.co.uk ',
  company: ' Smith & Partners ',
  interest: 'Underwriting workflow',
  message: 'Can we review our KYC workflow?\nWe have 12 users.',
};

test('validates required business details without rejecting normal punctuation', () => {
  assert.deepEqual(validateDemoRequest(request), {});
  assert.deepEqual(Object.keys(validateDemoRequest({ ...request, name: ' ', email: 'bad', company: ' ' })), ['name', 'email', 'company']);
  assert.ok(validateDemoRequest({ ...request, email: 'a@firm.co.uk\nBcc:other@firm.co.uk' }).email);
  assert.ok(validateDemoRequest({ ...request, message: 'a'.repeat(2001) }).message);
  assert.ok(validateDemoRequest({ ...request, name: 'a'.repeat(121) }).name);
  assert.ok(validateDemoRequest({ ...request, company: 'a'.repeat(161) }).company);
  assert.ok(validateDemoRequest({ ...request, interest: ' ' }).interest);
});

test('offers only software demo interests and accepts each one', () => {
  for (const interest of DEMO_INTERESTS) {
    assert.deepEqual(validateDemoRequest({ ...request, interest }), {});
  }
  assert.ok(validateDemoRequest({ ...request, interest: 'Personal loan' }).interest);
  assert.deepEqual(validateDemoRequest({ ...request, company: 'Élan & Partners', message: '' }), {});
});
