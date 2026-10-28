'use strict';

/**
 * Upload guard (tester bugs 20-10-2026):
 *  - files over the size limit (default 20 MB) must be refused by the API, not only the UI;
 *  - .exe (and other executables) must be refused;
 *  - the API must check the real file CONTENT (magic bytes), not just the extension,
 *    so an .exe renamed to .pdf is refused;
 *  - the file name is sanitised before it is stored / written to disk.
 *
 * checkUpload(name, buf) -> { ok: true, name } | { ok: false, error }
 */
let config = null;
try { ({ config } = require('../config/env')); } catch (_) { config = null; }

const MAX_BYTES = (config && config.uploads && Number(config.uploads.maxSize)) || 20 * 1024 * 1024;

/** Extensions allowed for case documents. */
const ALLOWED = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

/** Never allowed anywhere in the name (also catches "x.exe.pdf"). */
const BLOCKED = ['exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'msp', 'scr', 'pif', 'cpl', 'vbs', 'vbe', 'js', 'jse',
  'ws', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'jar', 'hta', 'lnk', 'reg', 'app', 'apk', 'bin', 'iso', 'dmg', 'html', 'htm', 'svg', 'php', 'asp', 'aspx'];

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf, from, to) => buf.slice(from, to).toString('latin1');

/** Real type from content, or null when unknown. */
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (startsWith(buf, [0x4d, 0x5a])) return 'exe';                      // MZ  - Windows PE
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return 'exe';          // ELF
  if (startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(buf, [0xfe, 0xed, 0xfa, 0xce])) return 'exe'; // Mach-O
  if (ascii(buf, 0, 1024).includes('%PDF-')) return 'pdf';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(buf, 0, 4) === 'GIF8') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 0, 2) === 'BM') return 'bmp';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';  // .doc / .xls
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {                     // zip container
    const s = buf.toString('latin1');
    if (s.includes('word/')) return 'docx';
    if (s.includes('xl/')) return 'xlsx';
    return 'zip';
  }
  // plain text: no NUL bytes in the first 8 KB
  const head = buf.slice(0, 8192);
  if (!head.includes(0)) return 'text';
  return null;
}

/** Which sniffed types are acceptable for each extension. */
const MATCH = {
  pdf: ['pdf'], png: ['png'], jpg: ['jpg'], jpeg: ['jpg'], gif: ['gif'], webp: ['webp'], bmp: ['bmp'],
  doc: ['ole'], xls: ['ole'], docx: ['docx'], xlsx: ['xlsx'], csv: ['text'], txt: ['text'],
};

/** Safe display / storage name: no path, no control or odd chars, max 200 chars. */
function sanitizeName(name) {
  let n = String(name || '').replace(/^.*[\\/]/, '');           // drop any path
  n = n.replace(/[\u0000-\u001f\u007f]/g, '');                   // control chars
  n = n.replace(/[<>:"|?*;=`{}[\]\\^~$%#&]+/g, '_').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '');                                      // no hidden / dot-leading names
  if (n.length > 200) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 ? n.slice(dot) : '';
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n;
}

function checkUpload(name, buf, opts = {}) {
  const max = opts.maxBytes || MAX_BYTES;
  const allowed = opts.allowed || ALLOWED;
  const clean = sanitizeName(name);
  if (!clean) return { ok: false, error: 'File name is not valid' };
  if (!buf || !buf.length) return { ok: false, error: 'File is empty or not valid base64' };
  if (buf.length > max) return { ok: false, error: `File must be ${Math.round(max / 1024 / 1024)} MB or smaller` };

  const parts = clean.toLowerCase().split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1] : '';
  if (parts.slice(1).some((p) => BLOCKED.includes(p))) return { ok: false, error: 'This file type is not allowed' };
  if (!ext || !allowed.includes(ext)) {
    return { ok: false, error: `Only ${allowed.map((e) => '.' + e).join(', ')} files are allowed` };
  }
  const real = sniff(buf);
  if (real === 'exe') return { ok: false, error: 'Executable files are not allowed' };
  if (!real || !(MATCH[ext] || []).includes(real)) {
    return { ok: false, error: `File content does not match the .${ext} extension` };
  }
  return { ok: true, name: clean, ext, type: real };
}

/**
 * Inbound e-mail attachments (pen-test 24-10-2026). Broader type list than staff uploads
 * (brokers send rtf / odt / tif / heic / zip / msg ...), but the same hard rules:
 * no executables (by content), no blocked extension anywhere in the name, content must
 * match the extension for every type we can recognise, max size.
 */
const INBOUND_ALLOWED = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'odt', 'ods',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic', 'zip', 'msg', 'eml'];

function checkInbound(name, buf, opts = {}) {
  const max = opts.maxBytes || MAX_BYTES;
  const allowed = opts.allowed || INBOUND_ALLOWED;
  const clean = sanitizeName(name);
  if (!clean) return { ok: false, error: 'file name is not valid' };
  if (!buf || !buf.length) return { ok: false, error: 'empty file' };
  if (buf.length > max) return { ok: false, error: `over ${Math.round(max / 1024 / 1024)} MB` };
  const parts = clean.toLowerCase().split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1] : '';
  if (parts.slice(1).some((p) => BLOCKED.includes(p))) return { ok: false, error: 'file type not allowed' };
  if (!ext || !allowed.includes(ext)) return { ok: false, error: 'file type not allowed' };
  const real = sniff(buf);
  if (real === 'exe') return { ok: false, error: 'executable content' };
  if (MATCH[ext] && !MATCH[ext].includes(real)) return { ok: false, error: `content does not match .${ext}` };
  return { ok: true, name: clean, ext, type: real };
}

/** On-disk file name: timestamp + safe chars only. */
function diskName(cleanName) {
  return Date.now() + '_' + String(cleanName).replace(/[^\w.\-]+/g, '_');
}

module.exports = { checkUpload, checkInbound, sanitizeName, sniff, diskName, MAX_BYTES, ALLOWED, INBOUND_ALLOWED };
