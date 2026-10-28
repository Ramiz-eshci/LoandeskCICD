'use strict';

/**
 * Extract enquiry fields from a free-form (non-fixed-format) email body.
 *
 * Strategy (configurable, resilient):
 *   1. If an Anthropic API key is configured, ask the model to pull the four
 *      fields as JSON.
 *   2. If the key is missing, the call fails, or the JSON is unusable, fall
 *      back to deterministic regex parsing so intake NEVER breaks.
 *
 * Returned shape (every value a trimmed string, "" when not found):
 *   { val, wantsUpTo, property, loanApply }
 *     val        <- loan / facility amount        ("facility of £250,000")
 *     wantsUpTo  <- period / term                 ("period of 12 months")
 *     loanApply  <- signer name                   (after "Kind regards,")
 *     property   <- any postal address found
 *
 * Node 20+ so global fetch is used.
 */

const { config } = require('../config/env');

const BLANK = { val: '', wantsUpTo: '', property: '', loanApply: '' };

/** Strip HTML to readable text. */
function htmlToText(content, contentType) {
  if (!content) return '';
  if (contentType && String(contentType).toLowerCase() === 'html') {
    return content
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }
  return String(content).trim();
}

const str = (v) => (v ?? '').toString().trim();

/**
 * Read Anthropic's error body so the log says WHY a call failed
 * (e.g. 401 invalid x-api-key, 400 credit balance too low, 404 unknown model),
 * not just the status code. The API key itself is never logged.
 */
async function anthropicError(resp, step) {
  let detail = '';
  try {
    const text = await resp.text();
    try {
      const j = JSON.parse(text);
      detail = [j?.error?.type, j?.error?.message].filter(Boolean).join(': ') || text;
    } catch (_) { detail = text; }
  } catch (_) { /* body unreadable */ }
  const msg = `Anthropic API returned ${resp.status}${detail ? ' - ' + String(detail).slice(0, 500) : ''}`;
  // eslint-disable-next-line no-console
  console.error(`[emailExtractor] AI ${step} failed:`, msg, '| model:', config.ai.anthropicModel,
    '| key set:', !!config.ai.anthropicApiKey);
  return msg;
}

/**
 * Determine whether an email is genuinely a loan/finance enquiry.
 * The AI analyzes BOTH the subject and body, so no fixed subject is required.
 */
async function classifyLoanEnquiry(subject, body) {
  if (!config.ai.anthropicApiKey) {
    throw new Error('Anthropic API key is not configured');
  }

  const bodyText = htmlToText(body, 'html');
  console.log('[outlook] classifying email with AI:', { subject, bodyText });

  const prompt = `
You are an AI classifier for a loan and finance enquiry system.

Determine whether this email is genuinely related to a person or business
requesting, seeking, or enquiring about a loan, finance, funding, mortgage,
borrowing, property finance, business finance, development finance, or
similar lending.

Analyze BOTH the email subject and email body.

TRUE examples:
- "I need £500,000 to purchase a property"
- "Looking for funding for my development"
- "Can you provide finance for this property?"
- "We want to borrow £1m"
- "Funding requirement for commercial property"
- "Can you help with a mortgage?"
- "I am looking for finance"

FALSE examples:
- Newsletters
- Marketing emails
- Advertisements
- Spam
- Bank statements
- Payment confirmations
- Transaction notifications
- General banking notifications
- Job applications
- General business conversations
- Emails that only mention a loan but are not requesting finance
- Emails unrelated to borrowing or financing

IMPORTANT:
Do not classify an email as a loan enquiry merely because words such as
"loan", "finance", "money", "bank", or "funding" appear.
Look at the actual intent of the email.

Example FALSE:
Subject: Loan update
Body: Your existing loan payment has been received.

Example TRUE:
Subject: Can you help?
Body: I am looking for £500,000 finance to purchase a commercial property.

Return ONLY valid JSON:
{
  "isLoanEnquiry": true,
  "confidence": 0.95,
  "reason": "Short explanation."
}

Confidence:
0.90-1.00 = very strong
0.80-0.89 = strong
0.60-0.79 = uncertain
0.00-0.59 = weak/no evidence

If ambiguous, return false. Do not guess.

EMAIL SUBJECT:
"""
${subject || ''}
"""

EMAIL BODY:
"""
${bodyText || ''}
"""
`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  console.log('body', JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }));

  if (!resp.ok) {
    throw new Error(await anthropicError(resp, 'classify'));
  }

  const data = await resp.json();

  const raw = (data.content || [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  const parsed = JSON.parse(raw);

  return {
    isLoanEnquiry: Boolean(parsed.isLoanEnquiry),
    confidence: Number(parsed.confidence) || 0,
    reason: str(parsed.reason),
  };
}

/** Deterministic parser — no external dependency. Best-effort. */
function extractDeterministic(text) {
  const out = { ...BLANK };
  if (!text) return out;

  // Amount: currency symbol + number, or "amount/facility/loan of <n>"
  const amount =
    text.match(/(?:£|\$|€|gbp|usd|eur)\s?[\d][\d,]*(?:\.\d{1,2})?/i) ||
    text.match(/(?:facility|loan|amount|advance|borrow(?:ing)?)[^\d£$€]{0,20}([\d][\d,]{2,}(?:\.\d{1,2})?)/i);
  if (amount) out.val = str(amount[0]).replace(/^(?:facility|loan|amount|advance|borrowing)[^\d£$€]*/i, '');

  // Term: "<n> months" / "<n> years" / "<n> yr"
  const term = text.match(/(\d+)\s*(month|months|mo|year|years|yr|yrs)\b/i);
  if (term) out.wantsUpTo = `${term[1]} ${/year|yr/i.test(term[2]) ? 'years' : 'months'}`;

  // Signer name: line after a sign-off
  const sign = text.match(/(?:kind regards|regards|many thanks|thanks|yours sincerely|yours faithfully|best wishes|cheers)[,\s]*\n+\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i);
  if (sign) out.loanApply = str(sign[1]);

  // Address: line containing a UK-ish postcode
  const postcodeLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(l));
  if (postcodeLine) out.property = str(postcodeLine).slice(0, 500);

  return out;
}

/** Ask Anthropic to extract the four fields. Throws on any failure. */
async function extractWithAi(text) {
  const prompt = `You are extracting structured data from a free-form business enquiry email. The email has no fixed format and may phrase everything differently each time.

Extract these four fields and return ONLY a JSON object (no markdown, no code fences, no commentary) with exactly these keys:

- "val": the loan / facility amount requested (e.g. from a phrase like "facility of £250,000"). Return the amount as written including any currency symbol, or "" if none is stated.
- "wantsUpTo": the period / term of the facility (e.g. from "period of 12 months"). Return it like "12 months", or "" if none is stated.
- "loanApply": the name of the person who signed the email, i.e. the name that appears after a sign-off such as "Kind regards,", "Regards,", "Many thanks,", "Yours sincerely,", etc. Return just the name, or "" if none is found.
- "property": any full postal address mentioned anywhere in the email. Return it as a single line, or "" if no address is present.

If a field is not present, use an empty string "". Do not guess or invent values.

Email:
"""
${text}
"""`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error(await anthropicError(resp, 'extract'));

  const data = await resp.json();
  const raw = (data.content || [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  const parsed = JSON.parse(raw);
  return {
    val: str(parsed.val),
    wantsUpTo: str(parsed.wantsUpTo),
    property: str(parsed.property),
    loanApply: str(parsed.loanApply),
  };
}

async function extractFormFields(content, contentType) {
  const text = htmlToText(content, contentType);
  if (!text) return { ...BLANK };

  if (config.ai.anthropicApiKey) {
    try {
      const ai = await extractWithAi(text);
      // If the model returned nothing useful, top up with deterministic hits.
      const det = extractDeterministic(text);
      return {
        val: ai.val || det.val,
        wantsUpTo: ai.wantsUpTo || det.wantsUpTo,
        property: ai.property || det.property,
        loanApply: ai.loanApply || det.loanApply,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[emailExtractor] AI extraction failed, using deterministic fallback:', err.message);
      return extractDeterministic(text);
    }
  }

  return extractDeterministic(text);
}

module.exports = {
  extractFormFields,
  htmlToText,
  extractDeterministic,
  classifyLoanEnquiry
};
