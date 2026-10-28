'use strict';

/**
 * Outlook -> Enquiry intake controller.
 *
 * Microsoft Graph change-notification webhook: when a new message lands in the
 * configured mailbox inbox, Graph POSTs here; we fetch the full message and
 * hand it to services/emailIngestion, which creates a LoanDesk enquiry.
 *
 * /webhook and /lifecycle are PUBLIC (Graph calls them, no auth). They must
 * respond fast and, for the initial handshake, echo the validationToken as
 * plain text. /create-subscription is authenticated (see routes).
 *
 * NOTE: if you enable transport encryption (ENCRYPTION_ENABLED=true), the
 * /webhook and /lifecycle paths must be exempted from the crypto gate — Graph
 * has no crypto session. They already reply with sendStatus/text (not the
 * JSON envelope), so only the inbound gate needs the exemption.
 */

const { getGraphClient } = require('../config/microsoftGraph.service');
const { config } = require('../config/env');
const R = require('../services/response.service');
const ingestion = require('../services/emailIngestion.service');
const emailReply = require('../services/emailReply.service');
const { classifyLoanEnquiry } = require('../services/emailExtractor.service');
const db = require('../config/database');
const crypto = require('crypto');

// Message ids currently being processed in THIS instance — guards against Graph
// redelivering the same notification concurrently. The DB UNIQUE(message_id)
// constraint is the cross-instance safety net.
const inFlight = new Set();

// ---- request authenticity (pen-test 24-10-2026) --------------------------------
// /webhook and /lifecycle are public, so every notification must carry the secret
// clientState we registered with Graph. No secret configured => nothing is trusted
// (previously undefined === undefined let a forged notification through).
function validClientState(n) {
  const expected = String(config.graph.clientState || '');
  const got = String((n && n.clientState) || '');
  if (expected.length < 16 || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
// Graph message ids are URL-safe base64 (A-Z a-z 0-9 - _ =); subscription ids are GUIDs.
// Anything else (/, ., ?, #, %) could change the Graph URL path, so it is ignored.
const GRAPH_ID = /^[A-Za-z0-9_\-=]{1,512}$/;
const GUID = /^[0-9a-fA-F-]{36}$/;
/** Graph's subscription handshake: echo the token as text/plain (bounded, never HTML). */
function echoValidation(req, res) {
  const token = req.query.validationToken;
  if (token === undefined) return false;
  if (typeof token !== 'string' || token.length > 1024) { res.sendStatus(400); return true; }
  res.status(200).type('text/plain').send(token);
  return true;
}

/** Public webhook — Graph change notifications for new inbox messages. */
exports.webhook = async (req, res) => {
  try {
    if (echoValidation(req, res)) return undefined;

    // Acknowledge immediately — Graph expects a response within ~10s.
    res.sendStatus(202);

    const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
    for (const n of notifications) {
      processNotification(n).catch((err) => console.error('[outlook] notification error:', err));
    }
  } catch (error) {
    console.error('[outlook] webhook error:', error);
    if (!res.headersSent) res.sendStatus(500);
  }
};

/** Public lifecycle endpoint — subscription reauth/removed/missed events. */
exports.lifecycle = async (req, res) => {
  try {
    if (echoValidation(req, res)) return undefined;

    const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
    for (const n of notifications) {
      if (!validClientState(n)) {
        console.warn('[outlook] lifecycle: clientState mismatch - ignoring');
        continue;
      }
      if (n.lifecycleEvent === 'reauthorizationRequired') {
        if (!GUID.test(String(n.subscriptionId || ''))) continue;
        console.warn(`[outlook] subscription ${n.subscriptionId} needs renewal`);
        renewSubscription(n.subscriptionId).catch((e) => console.error('[outlook] renew failed:', e.message));
      } else if (n.lifecycleEvent === 'subscriptionRemoved') {
        console.error(`[outlook] subscription ${n.subscriptionId} removed by Graph`);
      } else if (n.lifecycleEvent === 'missed') {
        console.warn(`[outlook] missed notifications for ${n.subscriptionId}`);
      }
    }
    res.sendStatus(202);
  } catch (error) {
    console.error('[outlook] lifecycle error:', error);
    if (!res.headersSent) res.sendStatus(500);
  }
};

/** Authenticated: create a Graph subscription for the mailbox inbox. */
exports.createSubscription = async (req, res) => {
  try {
    const result = await createGraphSubscription();
    return R.created(res, 'Outlook subscription created', {
      id: result.id, expirationDateTime: result.expirationDateTime,
    });
  } catch (error) {
    console.error('[outlook] create subscription failed:', error?.body || error);
    return R.badRequest(res, 'Failed to create Outlook subscription', { detail: error.message });
  }
};

/** Authenticated: admin email-intake log (from outlook_processed_emails). */
exports.listEmails = async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT o.outlook_email_id, o.message_id, o.sender, o.subject, o.received_at,
              o.has_attachments, o.raw_amount, o.raw_term, o.property, o.signer_name,
              e.enquiry_id, e.enquiry_ref, o.status, o.processed_at,
              o.module, o.record_id, o.match_method, o.error_message
         FROM outlook_processed_emails o
         -- deleted enquiry (soft delete): keep the email row, drop the link
         LEFT JOIN enquiries e ON e.enquiry_id = o.enquiry_id AND e.flag_deleted = 0
        ORDER BY o.outlook_email_id DESC`,
    );
    return R.ok(res, 'Outlook emails', rows);
  } catch (error) {
    console.error('[outlook] list emails failed:', error);
    return R.badRequest(res, 'Failed to list emails');
  }
};

// ------------------------------------------------------------------
// Graph helpers
// ------------------------------------------------------------------

async function createGraphSubscription() {
  const graph = getGraphClient();
  const minutes = config.graph.subscriptionMinutes;
  const subscription = {
    changeType: 'created',
    notificationUrl: config.graph.webhookUrl,
    lifecycleNotificationUrl: config.graph.lifecycleUrl,
    resource: `/users/${config.graph.mailbox}/mailFolders('inbox')/messages`,
    expirationDateTime: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    clientState: config.graph.clientState,
  };
  return graph.api('/subscriptions').post(subscription);
}

async function renewSubscription(subscriptionId) {
  const graph = getGraphClient();
  const minutes = config.graph.subscriptionMinutes;
  return graph.api(`/subscriptions/${subscriptionId}`).patch({
    expirationDateTime: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
  });
}

async function processNotification(notification) {
  if (!validClientState(notification)) {
    console.warn('[outlook] clientState mismatch — ignoring notification');
    return;
  }
  if (notification.changeType !== 'created') return;

  const messageId = notification.resourceData?.id;
  if (!messageId || !GRAPH_ID.test(String(messageId))) return;

  if (inFlight.has(messageId)) return;
  inFlight.add(messageId);
  try {
    const message = await getEmail(messageId);

    // Client 17-10-2026: a reply to an "Information required" e-mail goes to the case it
    // was sent from (attachments uploaded + note) and must NOT become a new enquiry.
    try {
      const reply = await emailReply.handleReply(message, () => getAttachments(messageId));
      if (reply.handled) {
        console.log(`[outlook] reply to info request: "${message.subject}" -> ${reply.module || '-'} #${reply.recordId || '-'} (${reply.saved || 0} doc(s))`);
        return;
      }
    } catch (err) {
      console.error(`[outlook] reply matching failed for ${messageId}:`, err.message);
    }

        // AI checks BOTH subject and body. No fixed subject is required.
        const classification = await classifyLoanEnquiry(
            message.subject,
            message.body?.content
        );

        console.log('[outlook] AI classification:', {
            subject: message.subject,
            isLoanEnquiry: classification.isLoanEnquiry,
            confidence: classification.confidence,
            reason: classification.reason
        });

        // Only create an enquiry when AI is sufficiently confident.
        if (!classification.isLoanEnquiry || classification.confidence < 0.80) {
            console.log(
                `[outlook] Email ignored - not a loan enquiry: "${message.subject}" ` +
                `(confidence=${classification.confidence})`
            );
            return;
        }

        console.log(
            `[outlook] Loan enquiry detected: "${message.subject}" ` +
            `(confidence=${classification.confidence})`
        );
    let attachments = [];
    if (message.hasAttachments) attachments = await getAttachments(messageId);

    const out = await ingestion.ingestMessage(message, attachments);
    if (out.skipped) {
      console.log(`[outlook] ${messageId} already processed, skipped`);
    } else if (out.ok) {
      console.log(`[outlook] created enquiry ${out.ref} (id=${out.enquiryId}) from "${message.subject}"`);
    } else {
      console.warn(`[outlook] ingest not ok for ${messageId}: ${out.reason}`);
    }
  } catch (err) {
    console.error(`[outlook] failed processing ${messageId}:`, err.message);
  } finally {
    inFlight.delete(messageId);
  }
}

async function getEmail(messageId) {
  const graph = getGraphClient();
  return graph
    .api(`/users/${config.graph.mailbox}/messages/${messageId}`)
    .select('id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,internetMessageId,conversationId,internetMessageHeaders')
    .get();
}

async function getAttachments(messageId) {
  const graph = getGraphClient();
  const result = await graph.api(`/users/${config.graph.mailbox}/messages/${messageId}/attachments`).get();
  return result.value || [];
}





// exported for the renewal job
exports.createGraphSubscription = createGraphSubscription;
exports.renewSubscription = renewSubscription;
