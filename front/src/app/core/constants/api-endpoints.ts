/**
 * Single source of truth for API paths (relative to environment.apiBaseUrl).
 * Mirrors api/app.js route mounts one-to-one; the client-side feature names
 * follow the LoanDesk product navigation, so a few keys are aliases.
 */
export const API = {
  crypto: {
    publicKey: '/crypto/public-key',
    session: '/crypto/session',
    validate: '/crypto/session/validate',
  },
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    selectRole: '/auth/select-role',
    verifyOtp: '/auth/verify-otp',
    resendOtp: '/auth/resend-otp',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    validateResetToken: '/auth/reset-password/validate',
    profile: '/auth/profile',
    profilePassword: '/auth/profile/password',
    profileAvatar: '/auth/profile/avatar',
  },
  example: {
    ping: '/example/ping',
    echo: '/example/echo',
    whoami: '/example/whoami',
    secure: '/example/secure',
  },
  health: '/health',

  // CRUD resource bases (each exposes GET / , GET /:id, POST / , PUT /:id, DELETE /:id)
  enquiries: '/enquiries',
  notifications: '/notifications',
  applications: '/applications',
  portfolio: '/portfolio',
  /** Portfolio Extensions workflow (client 30-09-2026). */
  extensions: '/extensions',
  underwriting: '/underwriting',
  credit: '/credit',
  legal: '/legal',
  valuations: '/valuations',
  category: '/category',
  /** Customers screen -> client resource. */
  customers: '/client',
  client: '/client',
  manufacturer: '/manufacturer',
  model: '/model',
  list: '/list',
  status: '/status',
  user: '/user',
  /** Dashboard screen -> dashbord resource (API spelling kept as-is). */
  dashboard: '/dashbord',
  dashbord: '/dashbord',
  reports: '/reports',
  audit: '/audit',
  roles: '/roles',
  permissions: '/permissions',
  modules: '/modules',
  masters: '/masters',
  /** Masters > Email Settings / Email History (client 17-10-2026). */
  emailSettings: '/email-settings',
  emailHistory: '/email-history',
} as const;
