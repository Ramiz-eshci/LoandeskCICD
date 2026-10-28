'use strict';

/** e-mail reply attachments: type, size and (pen-test 24-10-2026) real-content checks. */

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../config/microsoftGraph.service', () => ({ getGraphClient: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { usableAttachments } = require('../../../services/emailReply.service');

const att = (name, buf, extra = {}) => ({
  '@odata.type': '#microsoft.graph.fileAttachment', name, contentBytes: Buffer.from(buf).toString('base64'), ...extra,
});
const PDF = Buffer.from('%PDF-1.7 ...');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)]);

describe('emailReply.usableAttachments', () => {
  it('keeps genuine documents', () => {
    const { files, skipped } = usableAttachments([att('Bank Statement.pdf', PDF)]);
    expect(files.map((f) => f.name)).toEqual(['Bank Statement.pdf']);
    expect(skipped).toEqual([]);
  });

  it('refuses an executable renamed to .pdf and lists it as skipped', () => {
    const { files, skipped } = usableAttachments([att('statement.pdf', EXE), att('ok.pdf', PDF)]);
    expect(files.map((f) => f.name)).toEqual(['ok.pdf']);
    expect(skipped).toEqual(['statement.pdf (executable content)']);
  });

  it('refuses double extensions and disallowed types', () => {
    const { skipped } = usableAttachments([att('id.exe.pdf', PDF), att('page.html', Buffer.from('<html>')), att('run.exe', EXE)]);
    expect(skipped).toEqual([
      'id.exe.pdf (file type not allowed)',
      'page.html (file type not allowed)',
      'run.exe (file type not allowed)',
    ]);
  });

  it('skips small inline signature images silently and reference attachments', () => {
    const { files, skipped } = usableAttachments([
      att('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { isInline: true, contentType: 'image/png' }),
      { '@odata.type': '#microsoft.graph.referenceAttachment', name: 'link' },
    ]);
    expect(files).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('sanitises the stored name', () => {
    expect(usableAttachments([att('..\\\\..\\\\evil<x>.pdf', PDF)]).files[0].name).toBe('evil_x_.pdf');
  });
});
