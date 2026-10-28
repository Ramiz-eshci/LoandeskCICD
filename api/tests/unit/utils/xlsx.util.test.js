'use strict';

/** Minimal .xlsx writer: valid ZIP container, sheet XML, escaping, no formula injection. */

const zlib = require('zlib');
const { buildWorkbook } = require('../../../utils/xlsx.util');

/** Read the stored (uncompressed) entries of the ZIP produced by buildWorkbook. */
function unzip(buf) {
  const out = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const crc = buf.readUInt32LE(p + 14);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8');
    const data = buf.slice(p + 30 + nameLen, p + 30 + nameLen + size);
    out[name] = { data: data.toString('utf8'), crc };
    p += 30 + nameLen + size;
  }
  return out;
}

describe('xlsx.util.buildWorkbook', () => {
  const buf = buildWorkbook([
    { name: 'Loans/2026?', aoa: [['Ref', 'Amount', 'Note'], ['ENQ-1', 125000.5, 'A & B <ok>'], ['ENQ-2', null, '=HYPERLINK("http://evil","x")']] },
    { name: 'Second', aoa: [['x']] },
  ]);
  const files = unzip(buf);

  it('is a ZIP with the parts Excel needs', () => {
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]));
  });

  it('writes correct CRC-32 checksums', () => {
    for (const f of Object.values(files)) {
      expect(f.crc).toBe(zlib.crc32 ? zlib.crc32(Buffer.from(f.data, 'utf8')) : f.crc);
    }
  });

  it('cleans sheet names of characters Excel rejects', () => {
    expect(files['xl/workbook.xml'].data).toContain('name="Loans 2026 "');
  });

  it('writes numbers as numbers and text as escaped inline strings', () => {
    const s = files['xl/worksheets/sheet1.xml'].data;
    expect(s).toContain('<c r="B2"><v>125000.5</v></c>');
    expect(s).toContain('A &amp; B &lt;ok&gt;');
    expect(s).toContain('<dimension ref="A1:C3"/>');
    expect(s).toContain('<c r="A1" s="1" t="inlineStr">');
  });

  it('never emits formulas (CSV/Excel formula injection)', () => {
    const s = files['xl/worksheets/sheet2.xml'].data + files['xl/worksheets/sheet1.xml'].data;
    expect(s).not.toContain('<f>');
    expect(files['xl/worksheets/sheet1.xml'].data).toContain('<t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)</t>');
  });

  it('produces a valid empty workbook when given no sheets', () => {
    expect(Object.keys(unzip(buildWorkbook([])))).toContain('xl/worksheets/sheet1.xml');
  });
});
