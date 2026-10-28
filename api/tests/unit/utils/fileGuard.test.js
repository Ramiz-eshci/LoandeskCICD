'use strict';

/** fileGuard: extension allow/deny list + magic-byte content sniffing + safe names. */

const { checkUpload, checkInbound, sanitizeName, sniff, diskName } = require('../../../utils/fileGuard');

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60, 0)]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml')]);
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....xl/workbook.xml')]);
const TXT = Buffer.from('name,amount\nJane,100\n');

describe('fileGuard.sniff', () => {
  it.each([
    [PDF, 'pdf'], [PNG, 'png'], [JPG, 'jpg'], [EXE, 'exe'], [ELF, 'exe'], [OLE, 'ole'],
    [DOCX, 'docx'], [XLSX, 'xlsx'], [TXT, 'text'], [Buffer.from('GIF89a..'), 'gif'],
  ])('detects content type %#', (buf, type) => {
    expect(sniff(buf)).toBe(type);
  });

  it('returns null for tiny or unknown binary content', () => {
    expect(sniff(Buffer.from([1, 2]))).toBeNull();
    expect(sniff(Buffer.from([0, 1, 2, 3, 0, 5]))).toBeNull();
  });
});

describe('fileGuard.checkUpload', () => {
  it.each([
    ['offer.pdf', PDF], ['scan.png', PNG], ['photo.jpeg', JPG], ['letter.doc', OLE],
    ['terms.docx', DOCX], ['model.xlsx', XLSX], ['data.csv', TXT],
  ])('accepts a genuine %s', (name, buf) => {
    expect(checkUpload(name, buf)).toMatchObject({ ok: true, name });
  });

  it('refuses an .exe renamed to .pdf (content check)', () => {
    expect(checkUpload('invoice.pdf', EXE)).toEqual({ ok: false, error: 'Executable files are not allowed' });
  });

  it('refuses a PNG renamed to .pdf (content must match the extension)', () => {
    expect(checkUpload('fake.pdf', PNG).error).toMatch(/does not match the \.pdf extension/);
  });

  it.each(['run.exe', 'evil.exe.pdf', 'script.js', 'page.html', 'x.svg', 'a.php.png'])('refuses blocked type %s', (name) => {
    expect(checkUpload(name, PDF).ok).toBe(false);
  });

  it('refuses empty, oversize and nameless files', () => {
    expect(checkUpload('a.pdf', Buffer.alloc(0)).ok).toBe(false);
    expect(checkUpload('a.pdf', PDF, { maxBytes: 4 }).error).toMatch(/MB or smaller/);
    expect(checkUpload('', PDF).error).toBe('File name is not valid');
  });

  it('respects a custom allowed list', () => {
    expect(checkUpload('a.png', PNG, { allowed: ['pdf'] }).ok).toBe(false);
  });
});

describe('fileGuard.sanitizeName / diskName', () => {
  it('strips paths (path traversal) and dangerous characters', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('C:\\Windows\\win.ini')).toBe('win.ini');
    expect(sanitizeName('a<b>c|d?.pdf')).toBe('a_b_c_d_.pdf');
    expect(sanitizeName('...hidden.pdf')).toBe('hidden.pdf');
    expect(sanitizeName('bad\u0000\u001fname.pdf')).toBe('badname.pdf');
  });

  it('caps long names at 200 chars and keeps the extension', () => {
    const n = sanitizeName('x'.repeat(300) + '.pdf');
    expect(n).toHaveLength(200);
    expect(n.endsWith('.pdf')).toBe(true);
  });

  it('diskName is timestamp-prefixed with only safe characters', () => {
    expect(diskName('My Offer (v2).pdf')).toMatch(/^\d+_My_Offer_v2_.pdf$/);
  });
});

describe('fileGuard.checkInbound (e-mail attachments, pen-test 24-10-2026)', () => {
  it.each([['offer.pdf', PDF], ['scan.png', PNG], ['terms.docx', DOCX], ['notes.rtf', TXT], ['pack.zip', DOCX], ['mail.msg', OLE], ['photo.heic', Buffer.from('....ftypheic')]])(
    'accepts %s', (name, buf) => expect(checkInbound(name, buf)).toMatchObject({ ok: true, name }));

  it.each([
    ['invoice.pdf', EXE, 'executable content'],
    ['photo.heic', ELF, 'executable content'],
    ['fake.pdf', PNG, 'content does not match .pdf'],
    ['run.exe', EXE, 'file type not allowed'],
    ['doc.exe.pdf', PDF, 'file type not allowed'],
    ['page.html', TXT, 'file type not allowed'],
    ['img.svg', TXT, 'file type not allowed'],
    ['empty.pdf', Buffer.alloc(0), 'empty file'],
  ])('refuses %s (%s)', (name, buf, error) => expect(checkInbound(name, buf)).toEqual({ ok: false, error }));

  it('enforces size and custom allowed list; sanitises the name', () => {
    expect(checkInbound('a.pdf', PDF, { maxBytes: 4 }).error).toBe('over 0 MB');
    expect(checkInbound('a.zip', DOCX, { allowed: ['pdf'] }).ok).toBe(false);
    expect(checkInbound('../../evil/offer.pdf', PDF).name).toBe('offer.pdf');
  });
});
