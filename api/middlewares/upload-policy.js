'use strict';

/**
 * Upload policy for every module (client 21-10-2026):
 *  - only Word, PDF, image and Excel files;
 *  - max 20 MB per file (MAX_UPLOAD_SIZE, client 22-10-2026).
 *
 * Files arrive as base64 JSON ({ file_name, content_base64 }), anywhere in the body
 * (single file, or arrays like signed_offers / uploads / files). Runs AFTER the
 * request is decrypted so it sees the real payload, BEFORE any route handler.
 */

const { config } = require('../config/env');
const R = require('../services/response.service');

const DEFAULT_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

function allowedExts() {
  const list = (config.uploads.allowedExtensions || []).map((e) => String(e).toLowerCase().replace(/^\./, ''));
  return list.length ? list : DEFAULT_EXTS;
}

/** Decoded byte size of a base64 string (data: prefix allowed). */
function b64Bytes(s) {
  const raw = String(s).replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  const pad = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - pad;
}

/** Collect every { name, size } file in the body (depth-limited walk). */
function collect(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 5) return;
  if (Array.isArray(node)) { for (const n of node) collect(n, out, depth + 1); return; }
  if (typeof node.content_base64 === 'string' && node.content_base64) {
    out.push({ name: String(node.file_name || node.filename || node.name || ''), size: b64Bytes(node.content_base64) });
  }
  for (const k of Object.keys(node)) {
    if (k !== 'content_base64' && node[k] && typeof node[k] === 'object') collect(node[k], out, depth + 1);
  }
}

module.exports = function uploadPolicy() {
  return function (req, res, next) {
    if (!req.body || typeof req.body !== 'object' || req.method === 'GET') return next();
    const files = [];
    collect(req.body, files, 0);
    if (!files.length) return next();

    const exts = allowedExts();
    const max = config.uploads.maxSize;
    const maxMb = Math.round(max / 1024 / 1024);
    for (const f of files) {
      const parts = f.name.toLowerCase().split('.');
      const ext = parts.length > 1 ? parts[parts.length - 1] : '';
      if (!ext || !exts.includes(ext)) {
        return R.badRequest(res, `File "${f.name || 'unnamed'}" is not an allowed type. Allowed: Word, PDF, image and Excel files.`,
          { file: `Allowed: ${exts.map((e) => '.' + e).join(', ')}` });
      }
      if (f.size > max) {
        return R.badRequest(res, `File "${f.name}" is over the ${maxMb}MB limit.`, { file: `Maximum size is ${maxMb}MB` });
      }
    }
    return next();
  };
};
