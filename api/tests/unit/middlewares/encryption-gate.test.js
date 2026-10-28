'use strict';

const encryptionGate = require('../../../middlewares/encryption-gate');

describe('middleware/encryption-gate (disabled in the test env)', () => {
  // setup.js sets ENCRYPTION_ENABLED=false, so the gate is a pass-through.
  it('is a no-op that calls next() when encryption is off', async () => {
    const next = jest.fn();
    await encryptionGate()({ path: '/api/enquiries', headers: {} }, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
