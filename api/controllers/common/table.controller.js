'use strict';

/** Centralised table names. Referenced by controllers/models, never by user input. */
module.exports = {
  TBL_USERS: 'users',
  TBL_ROLES: 'roles',
  TBL_PERMISSIONS: 'permissions',
  TBL_ROLE_PERMISSIONS: 'role_permissions',
  TBL_USER_ROLES: 'user_roles',
  TBL_AUDIT_LOGS: 'audit_logs',
  TBL_MODULES: 'modules',
  TBL_BRANCHES: 'branches',
  TBL_PRODUCTS: 'products',
  TBL_REFRESH_TOKENS: 'refresh_tokens',
  TBL_OTP_CHALLENGES: 'otp_challenges',
  TBL_PASSWORD_RESETS: 'password_resets',
  TBL_CRYPTO_SESSIONS: 'crypto_sessions',
  TBL_EXAMPLE: 'example_items',

  // --- domain tables (fill as modules are implemented) ---
  TBL_CLIENT: 'clients',
  TBL_CATEGORY: 'categories',
  TBL_MANUFACTURER: 'manufacturers',
  TBL_MODEL: 'models',
  TBL_STATUS: 'statuses',
  TBL_AUDIT: 'audits',

  // --- Module-4 Enquiries ---
  TBL_DEMO_REQUESTS: 'demo_requests',
  TBL_ENQUIRIES: 'enquiries',
  TBL_ENQUIRY_ASSIGNMENTS: 'enquiry_assignments',
  TBL_ENQUIRY_NOTES: 'enquiry_notes',
  TBL_ENQUIRY_STATUSES: 'enquiry_statuses',
  TBL_ENQUIRY_DOCUMENTS: 'enquiry_documents',
  TBL_APPLICATIONS: 'applications',
};
