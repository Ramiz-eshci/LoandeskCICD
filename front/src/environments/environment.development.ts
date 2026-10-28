/**
 * Development environment.
 * Point apiBaseUrl at the local LoanDesk API (default PORT=3400).
 * No secrets here — only the public base URL.
 */
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3400/api',

  /**
   * DESIGN MODE — dev only.
   * Lets every screen open without signing in so the UI can be reviewed
   * against the design. Set back to false once the API auth flow is wired up.
   */
  designMode: false,
};
