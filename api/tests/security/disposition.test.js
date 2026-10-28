'use strict';
/** Pen-test 24-10-2026 (R3): download headers must never throw or allow header/quote injection. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { disposition } = require('../../utils/disposition');

function sendWith(value) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      try { res.setHeader('Content-Disposition', value); res.end('ok'); } catch (e) { res.statusCode = 500; res.end(e.code); }
    }).listen(0, () => {
      http.get(`http://127.0.0.1:${srv.address().port}`, (r) => {
        r.resume(); r.on('end', () => { srv.close(); resolve({ status: r.statusCode, header: r.headers['content-disposition'] }); });
      });
    });
  });
}

describe('disposition()', () => {
  it('keeps plain ASCII names unchanged', () => {
    expect(disposition('Offer Letter.pdf')).toBe('attachment; filename="Offer Letter.pdf"');
    expect(disposition('a.pdf', 'inline')).toBe('inline; filename="a.pdf"');
  });
  it.each(['Offer – final.pdf', 'नमस्ते.pdf', 'Ελληνικά.docx', 'quote"inj.pdf', 'line\r\nSet-Cookie: x=1.pdf', 'back\\slash.pdf'])(
    'is a valid header for %j', async (name) => {
      const v = disposition(name, 'inline');
      const r = await sendWith(v);
      expect(r.status).toBe(200);
      expect(r.header).toBe(v);
      expect(v).not.toMatch(/[\r\n]/);
      expect(v.match(/"/g)).toHaveLength(2);
    });
  it('round-trips the UTF-8 name', () => {
    const v = disposition('Offer – final.pdf');
    expect(decodeURIComponent(v.split("UTF-8''")[1])).toBe('Offer – final.pdf');
  });
  it('falls back to "download" for an empty name', () => {
    expect(disposition('')).toBe('attachment; filename="download"');
  });
  it('the raw template the controllers used to build throws on non-Latin-1 names', async () => {
    const r = await sendWith('inline; filename="Offer – final.pdf"');
    expect(r.status).toBe(500);
  });
});

describe('controllers', () => {
  it('no controller builds Content-Disposition by hand', () => {
    const dir = path.join(__dirname, '../../controllers');
    const bad = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (!p.endsWith('.js')) return undefined;
      fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (/Content-Disposition/i.test(l) && !/disposition\(/.test(l)) bad.push(`${path.basename(p)}:${i + 1}`);
      });
      return undefined;
    });
    walk(dir);
    expect(bad).toEqual([]);
  });
});
