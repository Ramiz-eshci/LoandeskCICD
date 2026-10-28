/**
 * Upload policy for every module (client 21-10-2026): only Word, PDF, image and Excel
 * files, max 20 MB each. The API enforces the same rule (api/middlewares/upload-policy.js).
 */
export const MAX_UPLOAD_MB = 20; // client 22-10-2026: 20MB everywhere
export const IMAGE_UPLOAD_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
export const ALLOWED_UPLOAD_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', ...IMAGE_UPLOAD_EXTS];
/** Value for <input type="file" accept="…">. */
export const UPLOAD_ACCEPT = ALLOWED_UPLOAD_EXTS.map((e) => '.' + e).join(',');

export function uploadExtOk(name: string, exts: string[] = ALLOWED_UPLOAD_EXTS): boolean {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 && exts.includes(parts[parts.length - 1]);
}

/** Split picked files into allowed ones and a user message for the rest ('' when all fine). */
export function filterUploads(files: File[], exts: string[] = ALLOWED_UPLOAD_EXTS, maxMb = MAX_UPLOAD_MB): { ok: File[]; error: string } {
  const limit = maxMb * 1024 * 1024;
  const badType = files.filter((f) => !uploadExtOk(f.name, exts)).map((f) => f.name);
  const big = files.filter((f) => uploadExtOk(f.name, exts) && f.size > limit).map((f) => f.name);
  const ok = files.filter((f) => uploadExtOk(f.name, exts) && f.size <= limit);
  const msgs: string[] = [];
  if (badType.length) msgs.push(`${badType.join(', ')}: not an allowed file type (Word, PDF, image or Excel only).`);
  if (big.length) msgs.push(`${big.join(', ')}: over the ${maxMb}MB limit.`);
  return { ok, error: msgs.join(' ') };
}
