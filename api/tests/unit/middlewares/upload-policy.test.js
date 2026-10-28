'use strict';

/** Upload policy: only Word / PDF / image / Excel, max size, anywhere in the body. */

const uploadPolicy = require('../../../middlewares/upload-policy');
const { config } = require('../../../config/env');

function mockRes() {
  const res = { statusCode: 200 };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
}
const b64 = (bytes) => Buffer.alloc(bytes, 1).toString('base64');
const file = (name, bytes = 10) => ({ file_name: name, content_base64: b64(bytes) });

function run(body, method = 'POST') {
  const res = mockRes();
  const next = jest.fn();
  uploadPolicy()({ method, body }, res, next);
  return { res, next };
}

// Test the built-in policy, independent of ALLOWED_EXTENSIONS in the local .env.
let savedExts;
beforeEach(() => { savedExts = config.uploads.allowedExtensions; config.uploads.allowedExtensions = []; });
afterEach(() => { config.uploads.allowedExtensions = savedExts; });

describe('middleware/upload-policy', () => {
  it('ALLOWED_EXTENSIONS from .env overrides the default list', () => {
    config.uploads.allowedExtensions = ['pdf'];
    expect(run(file('a.pdf')).next).toHaveBeenCalled();
    expect(run(file('b.xlsx')).next).not.toHaveBeenCalled();
  });

  it.each(['a.pdf', 'b.DOCX', 'c.doc', 'd.xlsx', 'e.xls', 'f.png', 'g.jpeg', 'h.webp'])('allows %s', (name) => {
    expect(run(file(name)).next).toHaveBeenCalled();
  });

  it.each(['virus.exe', 'run.bat', 'page.html', 'shell.php', 'noext', 'x.svg'])('refuses %s with 400', (name) => {
    const { res, next } = run(file(name));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/not an allowed type/);
  });

  it('finds files nested in arrays / objects (signed_offers, uploads ...)', () => {
    const { res, next } = run({ notes: 'x', signed_offers: [file('ok.pdf'), { meta: { doc: file('bad.exe') } }] });
    expect(next).not.toHaveBeenCalled();
    expect(res.body.message).toContain('bad.exe');
  });

  it('refuses a file over the size limit', () => {
    const saved = config.uploads.maxSize;
    config.uploads.maxSize = 1024;
    try {
      const { res, next } = run(file('big.pdf', 2048));
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/over the/);
    } finally {
      config.uploads.maxSize = saved;
    }
  });

  it('measures the decoded size (data: prefix + base64 padding)', () => {
    const saved = config.uploads.maxSize;
    config.uploads.maxSize = 10;
    try {
      expect(run({ file_name: 'a.pdf', content_base64: 'data:application/pdf;base64,' + b64(10) }).next).toHaveBeenCalled();
      expect(run({ file_name: 'a.pdf', content_base64: b64(11) }).next).not.toHaveBeenCalled();
    } finally {
      config.uploads.maxSize = saved;
    }
  });

  it('ignores GET requests and bodies without files', () => {
    expect(run(file('x.exe'), 'GET').next).toHaveBeenCalled();
    expect(run({ name: 'no files here' }).next).toHaveBeenCalled();
    expect(run(undefined).next).toHaveBeenCalled();
  });
});
