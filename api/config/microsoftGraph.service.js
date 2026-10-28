'use strict';

/**
 * Microsoft Graph client (app-only / client-credentials).
 *
 * Uses an Azure AD app registration with APPLICATION permissions
 * (Mail.Read, and Mail.ReadWrite if you later move/flag messages) consented
 * for the tenant. No user is signed in — the app reads the configured
 * OUTLOOK_MAILBOX directly.
 *
 * Node 20+ so global fetch is available (no isomorphic-fetch/node-fetch).
 */

const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { config } = require('./env');

let _credential = null;

function credential() {
  if (_credential) return _credential;
  const { tenantId, clientId, clientSecret } = config.graph;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph is not configured (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET).');
  }
  _credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  return _credential;
}

/** Return an authenticated Graph client (token fetched per request). */
function getGraphClient() {
  const cred = credential();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await cred.getToken('https://graph.microsoft.com/.default');
        return token.token;
      },
    },
  });
}

module.exports = { getGraphClient };
