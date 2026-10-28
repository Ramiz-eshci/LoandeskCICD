import { ALLOWED_UPLOAD_EXTS, IMAGE_UPLOAD_EXTS, MAX_UPLOAD_MB, UPLOAD_ACCEPT, filterUploads, uploadExtOk } from './upload-policy.util';

const file = (name: string, mb = 1) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: mb * 1024 * 1024 });
  return f;
};

describe('upload-policy.util', () => {
  it('matches the API policy: Word / PDF / image / Excel, 20MB', () => {
    expect(MAX_UPLOAD_MB).toBe(20);
    expect(ALLOWED_UPLOAD_EXTS).toEqual(['pdf', 'doc', 'docx', 'xls', 'xlsx', ...IMAGE_UPLOAD_EXTS]);
    expect(UPLOAD_ACCEPT).toBe('.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.bmp');
  });

  it('uploadExtOk checks the last extension, case-insensitively', () => {
    expect(uploadExtOk('Offer.PDF')).toBe(true);
    expect(uploadExtOk('evil.pdf.exe')).toBe(false);
    expect(uploadExtOk('noext')).toBe(false);
    expect(uploadExtOk('photo.png', ['pdf'])).toBe(false);
  });

  it('filterUploads keeps good files and explains the rest', () => {
    const out = filterUploads([file('a.pdf'), file('b.exe'), file('c.docx', 21), file('d.xlsx', 20)]);
    expect(out.ok.map((f) => f.name)).toEqual(['a.pdf', 'd.xlsx']);
    expect(out.error).toBe('b.exe: not an allowed file type (Word, PDF, image or Excel only). c.docx: over the 20MB limit.');
  });

  it('filterUploads returns no error when everything is fine', () => {
    expect(filterUploads([file('a.png')], IMAGE_UPLOAD_EXTS, 5)).toEqual({ ok: [expect.any(File)], error: '' });
  });
});
