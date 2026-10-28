'use strict';

/** Email -> enquiry field extraction (deterministic parser + AI fallback path). */

const { config } = require('../../../config/env');
const ex = require('../../../services/emailExtractor.service');

const SAMPLE = [
  'Hi team,',
  'We are looking for a bridging facility of £250,000.50 for a period of 12 months',
  'against the property at 10 High Street, Edinburgh EH1 1AA.',
  '',
  'Kind regards,',
  'Jane Smith',
].join('\n');

describe('emailExtractor.htmlToText', () => {
  it('strips tags, scripts and styles and decodes entities for HTML bodies', () => {
    const html = '<style>p{}</style><script>alert(1)</script><p>Loan &amp; term</p><br/>Line&nbsp;2 &lt;ok&gt;';
    expect(ex.htmlToText(html, 'html')).toBe('Loan & term\nLine 2 <ok>');
  });

  it('returns plain-text bodies trimmed, and "" for empty input', () => {
    expect(ex.htmlToText('  hello  ', 'text')).toBe('hello');
    expect(ex.htmlToText(null, 'html')).toBe('');
  });
});

describe('emailExtractor.extractDeterministic', () => {
  it('pulls amount, term, address and signer from a free-form email', () => {
    expect(ex.extractDeterministic(SAMPLE)).toEqual({
      val: '£250,000.50',
      wantsUpTo: '12 months',
      property: 'against the property at 10 High Street, Edinburgh EH1 1AA.',
      loanApply: 'Jane Smith',
    });
  });

  it('understands "loan of <n>" without a currency symbol and years as the term', () => {
    const out = ex.extractDeterministic('Need a loan of 300,000 for 2 years please');
    expect(out.val).toBe('300,000');
    expect(out.wantsUpTo).toBe('2 years');
  });

  it('returns blanks when nothing matches', () => {
    expect(ex.extractDeterministic('hello')).toEqual({ val: '', wantsUpTo: '', property: '', loanApply: '' });
    expect(ex.extractDeterministic('')).toEqual({ val: '', wantsUpTo: '', property: '', loanApply: '' });
  });
});

describe('emailExtractor.extractFormFields', () => {
  const saved = { ...config.ai };
  const realFetch = global.fetch;
  afterEach(() => { Object.assign(config.ai, saved); global.fetch = realFetch; });

  it('uses the deterministic parser when no AI key is configured', async () => {
    config.ai.anthropicApiKey = '';
    global.fetch = jest.fn();
    expect((await ex.extractFormFields(SAMPLE, 'text')).val).toBe('£250,000.50');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefers AI values and tops up blanks from the deterministic parser', async () => {
    config.ai.anthropicApiKey = 'k';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '```json{"val":"£1","wantsUpTo":"","property":"","loanApply":"AI Name"}```' }] }),
    });
    const out = await ex.extractFormFields(SAMPLE, 'text');
    expect(out).toEqual({ val: '£1', wantsUpTo: '12 months', property: expect.stringContaining('EH1 1AA'), loanApply: 'AI Name' });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('k');
  });

  it('never writes the API key to the logs when the AI call fails (pen-test 24-10-2026)', async () => {
    const SECRET = 'sk-ant-TEST-SECRET-KEY-123';
    config.ai.anthropicApiKey = SECRET;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}', json: async () => ({}) });
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    await ex.extractFormFields(SAMPLE, 'text');
    await ex.classifyLoanEnquiry('Loan', SAMPLE).catch(() => undefined);
    const logged = spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toContain('authentication_error');
    expect(logged).not.toContain(SECRET);
    spies.forEach((s) => s.mockRestore());
  });

  it('falls back to the deterministic parser when the AI call fails', async () => {
    config.ai.anthropicApiKey = 'k';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key', json: async () => ({}) });
    // the failure is expected here - keep the test output clean
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await ex.extractFormFields(SAMPLE, 'text')).loanApply).toBe('Jane Smith');
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('AI extract failed'), expect.any(String), '| model:', expect.anything(), '| key set:', true);
    warn.mockRestore();
    error.mockRestore();
  });
});
