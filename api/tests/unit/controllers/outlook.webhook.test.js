'use strict';

/** Outlook / Graph webhook authenticity (pen-test 24-10-2026). */

jest.mock('../../../config/database', () => ({ query: jest.fn().mockResolvedValue([]) }));
jest.mock('../../../services/emailIngestion.service', () => ({ ingestMessage: jest.fn() }));
jest.mock('../../../services/emailReply.service', () => ({ handleReply: jest.fn().mockResolvedValue({ handled: true }) }));
jest.mock('../../../services/emailExtractor.service', () => ({ classifyLoanEnquiry: jest.fn() }));
jest.mock('../../../config/microsoftGraph.service', () => ({ getGraphClient: jest.fn() }));

const { getGraphClient } = require('../../../config/microsoftGraph.service');
const { config } = require('../../../config/env');
const ctrl = require('../../../controllers/outlook.controller');

const SECRET = 'a-very-long-client-state-secret-123';
const GUID = '7f105c7d-2dc5-4530-97cd-4e7ae6534c07';
const MSG_ID = 'AAMkAGVmMDEzMTM4LTZmYWUtNDdkNC1hMDZiLTU1OGY5OTZhYmY4OABGAAAAAAAiQ8W967B7TKBjgx9rVEURBwAiIsqMbYjsT5e-T7KzowPTAAAYbvZDAAA=';

let graphCalls;
function fakeGraph() {
  graphCalls = [];
  const chain = (path) => ({
    select: () => chain(path),
    get: async () => { graphCalls.push(['GET', path]); return { id: MSG_ID, subject: 's', body: { content: 'x' } }; },
    patch: async (b) => { graphCalls.push(['PATCH', path, b]); return {}; },
    post: async () => ({}),
  });
  getGraphClient.mockReturnValue({ api: (p) => chain(p) });
}
function res() {
  const r = { statusCode: 200, body: undefined, headersSent: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.type = (t) => { r.contentType = t; return r; };
  r.send = (b) => { r.body = b; r.headersSent = true; return r; };
  r.sendStatus = (c) => { r.statusCode = c; r.headersSent = true; return r; };
  return r;
}
const flush = () => new Promise((r) => setTimeout(r, 20));
const note = (over = {}) => ({ clientState: SECRET, changeType: 'created', resourceData: { id: MSG_ID }, ...over });

let saved;
beforeEach(() => {
  saved = config.graph.clientState;
  config.graph.clientState = SECRET;
  config.graph.mailbox = 'intake@lender.co.uk';
  fakeGraph();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { config.graph.clientState = saved; jest.restoreAllMocks(); });

describe('subscription handshake', () => {
  it('echoes the validationToken as text/plain', async () => {
    const r = res();
    await ctrl.webhook({ query: { validationToken: 'abc<script>' }, body: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.contentType).toBe('text/plain');
    expect(r.body).toBe('abc<script>');
  });

  it('refuses an oversized or non-string token', async () => {
    const r1 = res();
    await ctrl.lifecycle({ query: { validationToken: 'x'.repeat(2000) }, body: {} }, r1);
    expect(r1.statusCode).toBe(400);
    const r2 = res();
    await ctrl.webhook({ query: { validationToken: ['a', 'b'] }, body: {} }, r2);
    expect(r2.statusCode).toBe(400);
  });
});

describe('webhook notifications', () => {
  it('processes a notification with the right clientState', async () => {
    const r = res();
    await ctrl.webhook({ query: {}, body: { value: [note()] } }, r);
    await flush();
    expect(r.statusCode).toBe(202);
    expect(graphCalls).toEqual([['GET', `/users/intake@lender.co.uk/messages/${MSG_ID}`]]);
  });

  it.each([
    ['wrong clientState', note({ clientState: 'x'.repeat(SECRET.length) })],
    ['missing clientState', note({ clientState: undefined })],
    ['path-changing message id', note({ resourceData: { id: '../../users/ceo@x/messages/1' } })],
    ['query in message id', note({ resourceData: { id: 'abc?$select=*' } })],
  ])('ignores a notification with %s', async (_l, n) => {
    await ctrl.webhook({ query: {}, body: { value: [n] } }, res());
    await flush();
    expect(graphCalls).toEqual([]);
  });

  it('trusts nothing when no secret is configured (undefined === undefined case)', async () => {
    config.graph.clientState = undefined;
    await ctrl.webhook({ query: {}, body: { value: [note({ clientState: undefined })] } }, res());
    await flush();
    expect(graphCalls).toEqual([]);
  });

  it('copes with a malformed body', async () => {
    const r = res();
    await ctrl.webhook({ query: {}, body: { value: 'nope' } }, r);
    expect(r.statusCode).toBe(202);
  });
});

describe('lifecycle notifications', () => {
  it('renews the subscription only for an authentic reauthorizationRequired event', async () => {
    const r = res();
    await ctrl.lifecycle({ query: {}, body: { value: [{ clientState: SECRET, lifecycleEvent: 'reauthorizationRequired', subscriptionId: GUID }] } }, r);
    await flush();
    expect(r.statusCode).toBe(202);
    expect(graphCalls.map((c) => c.slice(0, 2))).toEqual([['PATCH', `/subscriptions/${GUID}`]]);
  });

  it.each([
    ['forged (no clientState)', { lifecycleEvent: 'reauthorizationRequired', subscriptionId: GUID }],
    ['forged (wrong clientState)', { clientState: 'nope', lifecycleEvent: 'reauthorizationRequired', subscriptionId: GUID }],
    ['bad subscription id', { clientState: SECRET, lifecycleEvent: 'reauthorizationRequired', subscriptionId: '../me' }],
  ])('ignores %s', async (_l, n) => {
    await ctrl.lifecycle({ query: {}, body: { value: [n] } }, res());
    await flush();
    expect(graphCalls).toEqual([]);
  });
});
