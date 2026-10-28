import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('demo API client submits business details and requires a successful acknowledgement', async (context) => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('https://api.example.com/api/') },
  });
  try {
    const { submitDemoRequest, DemoSubmissionError } = await server.ssrLoadModule('/src/lib/api.ts');
    const request = { name: ' Jane Smith ', email: ' jane@firm.co.uk ', company: ' Example Lender ', interest: 'Full platform', message: ' ' };
    const reference = 'b4f4f87a-6f4e-4f7d-a6ee-0b5d0fa3bcca';
    const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ status: true, data: { request_ref: reference } }), { status: 201 }));
    assert.deepEqual(await submitDemoRequest(request), { request_ref: reference });
    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, 'https://api.example.com/api/demo-requests');
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(options?.body as string), { name: 'Jane Smith', email: 'jane@firm.co.uk', company: 'Example Lender', interest: 'Full platform', message: null });

    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ status: false, message: 'Please check your details', errors: { company: 'Company is required', secret: 'ignored' } }), { status: 400 }));
    await assert.rejects(submitDemoRequest(request), (error: unknown) => {
      assert.ok(error instanceof DemoSubmissionError);
      assert.deepEqual((error as { fieldErrors: object }).fieldErrors, { company: 'Company is required' });
      return true;
    });

    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ status: true, data: {} }), { status: 201 }));
    await assert.rejects(submitDemoRequest(request), /did not confirm/);
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ status: false }), { status: 200 }));
    await assert.rejects(submitDemoRequest(request), /could not be saved/);
    fetch.mock.mockImplementation(async () => new Response('not JSON', { status: 502 }));
    await assert.rejects(submitDemoRequest(request), /unexpected response/);
    fetch.mock.mockImplementation(async () => { throw new TypeError('network unavailable'); });
    await assert.rejects(submitDemoRequest(request), /could not reach LoanDesk/);
  } finally {
    await server.close();
    context.mock.restoreAll();
  }
});
