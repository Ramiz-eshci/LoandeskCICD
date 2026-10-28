/**
 * Production environment.
 *
 * SECURITY: no secrets here. Only the public API base URL lives on the client.
 * All RSA/AES keys are generated at runtime (Web Crypto) and never leave memory;
 * the API's private key + master key stay server-side only.
 */
export const environment = {
  // Pen-test 24-10-2026: this is the production build's environment (fileReplacements
  // swaps in environment.development.ts for ng serve), so dev-only switches stay off.
  production: true,
  apiBaseUrl: '/api',

  /** Never enable in production — the auth guard would stop protecting routes. */
  designMode: false,
};
