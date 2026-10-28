'use strict';

/**
 * Branded HTML email templates for LoanDesk.
 * Colours/logo match the Angular sign-in design system:
 *   navy   #0f2244 / #0a1a38 / #163060
 *   gold   #eaab00 / #b98600
 * Logo is rendered as an inline "LD" wordmark (external mail clients cannot
 * fetch the app's local logo.png).
 */

const NAVY = '#0f2244';
const NAVY_DEEP = '#0a1a38';
const GOLD = '#eaab00';

/** Shared shell: header (logo), body slot, footer. */
function shell(innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f4f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(15,34,68,0.12);">
        <tr>
          <td style="background:linear-gradient(145deg,${NAVY_DEEP} 0%,${NAVY} 55%,#163060 100%);padding:26px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="background:#ffffff;border-radius:9px;padding:7px 11px;">
                <span style="display:inline-block;background:linear-gradient(135deg,${GOLD} 0%,#b98600 100%);color:${NAVY};font-weight:800;font-size:16px;width:30px;height:30px;line-height:30px;text-align:center;border-radius:6px;vertical-align:middle;">LD</span>
                <span style="display:inline-block;vertical-align:middle;margin-left:9px;">
                  <span style="display:block;font-size:17px;font-weight:800;color:${NAVY};letter-spacing:-0.01em;">LoanDesk</span>
                  <span style="display:block;font-size:10px;color:#6b7280;letter-spacing:0.02em;">Loan Management Platform</span>
                </span>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr><td style="padding:34px 32px 36px;">${innerHtml}</td></tr>
        <tr>
          <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #eef2f7;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">
              This is an automated message from LoanDesk. Please do not reply.<br>
              If you did not request this code, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#b0b8c4;">&copy; ${new Date().getFullYear()} LoanDesk. All rights reserved.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * One-time login passcode email.
 * @param {{ code:string, email?:string, ttlSeconds?:number }} p
 * @returns {{ subject:string, html:string }}
 */
function otpEmail({ code, ttlSeconds = 300 } = {}) {
  const minutes = Math.max(1, Math.round(Number(ttlSeconds) / 60));
  const boxes = String(code)
    .split('')
    .map(
      (d) =>
        `<span style="display:inline-block;width:44px;height:56px;line-height:56px;margin:0 4px;font-size:26px;font-weight:800;color:${NAVY};background:#f4f7fc;border:1px solid #e3e9f2;border-radius:10px;text-align:center;font-family:Consolas,Menlo,monospace;">${d}</span>`
    )
    .join('');

  const inner = `
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:${NAVY};">Verify Your Identity</h1>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#475569;">
      Use the one-time passcode below to finish signing in to your LoanDesk account.
    </p>
    <div style="text-align:center;margin:8px 0 20px;white-space:nowrap;">${boxes}</div>
    <p style="margin:0 0 4px;font-size:13px;color:#64748b;text-align:center;">
      This code expires in <strong style="color:${NAVY};">${minutes} minute${minutes > 1 ? 's' : ''}</strong>.
    </p>
    <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">
      For your security, never share this code with anyone. LoanDesk staff will never ask you for it.
    </p>`;

  return { subject: `${code} is your LoanDesk verification code`, html: shell(inner) };
}

/**
 * Forgot-password email with a single-use reset link.
 * @param {{ link:string, name?:string, ttlMinutes?:number }} p
 * @returns {{ subject:string, html:string }}
 */
function resetPasswordEmail({ link, name, ttlMinutes = 60 } = {}) {
  const safe = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const href = safe(link);
  const hello = name ? `Hi ${safe(name)},` : 'Hello,';
  const mins = Number(ttlMinutes);
  const lifetime = mins % 60 === 0 && mins >= 60
    ? `${mins / 60} hour${mins / 60 > 1 ? 's' : ''}`
    : `${mins} minute${mins > 1 ? 's' : ''}`;

  const inner = `
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:${NAVY};">Reset Your Password</h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#475569;">${hello}</p>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#475569;">
      We received a request to reset the password for your LoanDesk account. Click the button below to choose a new password.
    </p>
    <div style="text-align:center;margin:8px 0 22px;">
      <a href="${href}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;background:${NAVY};border-radius:8px;text-decoration:none;">Reset Password</a>
    </div>
    <p style="margin:0 0 4px;font-size:13px;color:#64748b;text-align:center;">
      This link expires in <strong style="color:${NAVY};">${lifetime}</strong> and can be used only once.
    </p>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;word-break:break-all;">
      If the button does not work, copy this link into your browser:<br /><a href="${href}" style="color:#64748b;">${href}</a>
    </p>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">
      If you did not request a password reset, you can ignore this email — your password will not change.
    </p>`;

  return { subject: 'Reset your LoanDesk password', html: shell(inner) };
}

module.exports = { otpEmail, resetPasswordEmail, shell };
