'use strict';

/**
 * Keeps the Microsoft Graph mailbox subscription alive.
 *
 * Graph message subscriptions are short-lived (we request 24h) and must be
 * renewed before they expire. On boot we ensure a subscription exists for our
 * webhook URL; then on an interval we PATCH its expiration (or create one if
 * none is found). No extra scheduler dependency — plain setInterval.
 *
 * Started from server.js (never from app.js, which stays side-effect free).
 */

const { config } = require('../config/env');
const { getGraphClient } = require('../config/microsoftGraph.service');
const ctrl = require('../controllers/outlook.controller');

function isConfigured() {
  const g = config.graph;
  return !!(g.tenantId && g.clientId && g.clientSecret && g.mailbox && g.webhookUrl);
}

/** Ensure exactly one live subscription for our webhook URL. */
async function ensureSubscription() {
  const graph = getGraphClient();
  const existing = await graph.api('/subscriptions').get();
  const ours = (existing.value || []).filter((s) => s.notificationUrl === config.graph.webhookUrl);

  if (ours.length) {
    for (const sub of ours) {
      await ctrl.renewSubscription(sub.id);
      console.log(`[outlook] renewed subscription ${sub.id}`);
    }
    return;
  }
  const created = await ctrl.createGraphSubscription();
  console.log(`[outlook] created subscription ${created.id} (expires ${created.expirationDateTime})`);
}

function startSubscriptionRenewal() {
  if (!config.graph.autoRenew) {
    console.log('[outlook] auto-renew disabled (GRAPH_AUTO_RENEW=false)');
    return;
  }
  if (!isConfigured()) {
    console.log('[outlook] Graph not configured — subscription renewal skipped');
    return;
  }

  const run = () =>
    ensureSubscription().catch((err) =>
      console.error('[outlook] subscription renewal error:', err?.message || err),
    );

  // Once on boot, then every half of the subscription lifetime.
  run();
  const everyMs = Math.max(30, Math.floor(config.graph.subscriptionMinutes / 2)) * 60 * 1000;
  const timer = setInterval(run, everyMs);
  if (timer.unref) timer.unref();
  console.log(`[outlook] subscription renewal scheduled every ${Math.round(everyMs / 60000)} min`);
}

module.exports = { startSubscriptionRenewal, ensureSubscription };
