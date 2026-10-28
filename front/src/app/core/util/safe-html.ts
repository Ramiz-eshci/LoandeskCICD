import DOMPurify from 'dompurify';

/**
 * Pen-test 24-10-2026: HTML that is written into the live page (e.g. the Email
 * Settings editor's innerHTML) goes through DOMPurify with the SAME allow-list the
 * API uses (api/services/emailHub.service.js sanitizeHtml). Scripts, event handlers,
 * javascript: links, SVG/MathML, forms and iframes are removed; formatting, tables,
 * inline styles and {{Placeholders}} are kept.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'small', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'pre', 'code',
  'ul', 'ol', 'li', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
];
const ALLOWED_ATTR = [
  'style', 'class', 'align', 'title',
  'href', 'name', 'target', 'rel',
  'src', 'alt', 'width', 'height',
  'color', 'face', 'size',
  'border', 'cellpadding', 'cellspacing', 'bgcolor', 'colspan', 'rowspan', 'valign', 'span',
];
/** http(s) / mailto / tel / #anchor / cid / {{Placeholder}} - never javascript: or data: (except images). */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|cid):|#|\{\{\s*[A-Za-z0-9_]+\s*\}\}$)/i;

/** Drop inline styles that try to smuggle script (same as the API side). */
const BAD_STYLE = /javascript:|vbscript:|expression\s*\(|-moz-binding|behavior\s*:/i;
let hookAdded = false;
function ensureHook(): void {
  if (hookAdded) return;
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && BAD_STYLE.test(data.attrValue.replace(/\\|\s+/g, ''))) data.keepAttr = false;
  });
  hookAdded = true;
}

/** Attributes that are never URLs - exempt them from the URI check above. */
const NON_URI_ATTR = ALLOWED_ATTR.filter((a) => a !== 'href' && a !== 'src');

export function cleanEmailHtml(html: string | null | undefined): string {
  ensureHook();
  return DOMPurify.sanitize(String(html ?? ''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_URI_SAFE_ATTR: NON_URI_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
