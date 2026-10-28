'use strict';

/**
 * Static OpenAPI 3 spec (Doc-03 Section 25). Hand-written to avoid the
 * swagger-jsdoc/ajv dependency chain. Served by swagger-ui-express at /api-docs.
 */

const okEnvelope = {
  type: 'object',
  properties: {
    status: { type: 'boolean' },
    message: { type: 'string' },
    data: {},
    errors: { nullable: true },
    meta: { nullable: true },
  },
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'LoanDesk API',
    version: '1.0.0',
    description: 'Authentication, Users, Roles & Permissions (backend-controlled RBAC).',
  },
  servers: [{ url: '/api', description: 'API base' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: { ApiResponse: okEnvelope },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth' },
    { name: 'Users' },
    { name: 'Roles' },
    { name: 'Permissions' },
    { name: 'Masters' },
    { name: 'Enquiries' },
    { name: 'Demo requests' },
    { name: 'Portfolio' },
  ],
  paths: {
    '/portfolio/facilities': {
      get: { tags: ['Portfolio'], summary: 'List active portfolio facilities for customer-log selection', responses: { 200: { description: 'Portfolio facilities' } } },
    },
    '/portfolio/customers': {
      get: { tags: ['Portfolio'], summary: 'List portfolio customers grouped from active facilities', responses: { 200: { description: 'Portfolio customers' } } },
    },
    '/portfolio/contacts': {
      get: { tags: ['Portfolio'], summary: 'List portfolio customer contact logs', responses: { 200: { description: 'Contact logs' } } },
      post: { tags: ['Portfolio'], summary: 'Create a portfolio customer contact log', responses: { 201: { description: 'Contact log created' }, 400: { description: 'Validation error' } } },
    },
    '/portfolio/contacts/{logId}': {
      patch: { tags: ['Portfolio'], summary: 'Update a portfolio customer contact log', parameters: [{ name: 'logId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Contact log updated' }, 404: { description: 'Not found' } } },
      delete: { tags: ['Portfolio'], summary: 'Soft-delete a portfolio customer contact log', parameters: [{ name: 'logId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Contact log deleted' } } },
    },
    '/portfolio/reminders/overdue': {
      get: { tags: ['Portfolio'], summary: 'List overdue portfolio follow-ups for dashboard/bell use', responses: { 200: { description: 'Overdue follow-ups' } } },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'], security: [], summary: 'Login step 1: verify credentials, issue OTP challenge (no session yet)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['email', 'password'],
            properties: { email: { type: 'string' }, password: { type: 'string' } },
          } } },
        },
        responses: {
          200: { description: 'OTP sent. Response data has { challengeId, otpRequired, defaultOtp, expiresInSeconds }. Call /auth/verify-otp next.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          400: { description: 'Invalid email or password' },
        },
      },
    },
    '/auth/verify-otp': {
      post: {
        tags: ['Auth'], security: [], summary: 'Login step 2: verify OTP -> issue session (access token + roles + permissions)',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['challengeId', 'otp'],
          properties: { challengeId: { type: 'string' }, otp: { type: 'string', description: '6-digit numeric code' } },
        } } } },
        responses: {
          200: { description: 'Login successful (session issued). requiresRoleSelection=true when >1 role.' },
          400: { description: 'Invalid/expired/incorrect code' },
        },
      },
    },
    '/auth/select-role': {
      post: {
        tags: ['Auth'], summary: 'Select active workspace/role (re-issues a scoped access token)',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['roleId'], properties: { roleId: { type: 'integer' } },
        } } } },
        responses: { 200: { description: 'Workspace selected (accessToken + permissions)' },
          403: { description: 'Role not assigned to this user' } },
      },
    },
    '/auth/refresh': {
      post: { tags: ['Auth'], security: [], summary: 'Rotate access token (refresh cookie + CSRF header)',
        responses: { 200: { description: 'Token refreshed' }, 401: { description: 'Invalid refresh token' } } },
    },
    '/auth/logout': {
      get: { tags: ['Auth'], security: [], summary: 'Logout (revokes refresh token)',
        responses: { 200: { description: 'Logged out' } } },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user + roles + active-role permissions',
        responses: { 200: { description: 'Current user' }, 401: { description: 'Unauthorized' } } },
    },
    '/user': {
      get: { tags: ['Users'], summary: 'List users', responses: { 200: { description: 'Users' } } },
      post: { tags: ['Users'], summary: 'Create user (with roleIds)',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['email', 'password', 'full_name'],
          properties: { email: { type: 'string' }, password: { type: 'string' }, full_name: { type: 'string' },
            branch_id: { type: 'integer' }, phone: { type: 'string' },
            roleIds: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { 201: { description: 'User created' }, 400: { description: 'Validation error' } } },
    },
    '/user/{id}': {
      get: { tags: ['Users'], summary: 'Get user by id', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'User' }, 404: { description: 'Not found' } } },
      put: { tags: ['Users'], summary: 'Update user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Users'], summary: 'Soft-delete user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/user/{id}/roles': {
      post: { tags: ['Users'], summary: 'Assign roles to a user (multi-role)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['roleIds'], properties: { roleIds: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { 200: { description: 'Roles assigned' } } },
    },
    '/roles': {
      get: { tags: ['Roles'], summary: 'List roles', responses: { 200: { description: 'Roles' } } },
      post: { tags: ['Roles'], summary: 'Create role',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['roleName'], properties: { roleName: { type: 'string' }, description: { type: 'string' } } } } } },
        responses: { 201: { description: 'Role created' } } },
    },
    '/roles/{id}': {
      put: { tags: ['Roles'], summary: 'Update role', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Roles'], summary: 'Soft-delete role', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/roles/{id}/permissions': {
      get: { tags: ['Roles'], summary: 'Permissions granted to a role', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Role permissions' } } },
      put: { tags: ['Roles'], summary: 'Replace role permissions',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['permissionIds'], properties: { permissionIds: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { 200: { description: 'Updated' } } },
    },
    '/masters/{key}': {
      get: {
        tags: ['Masters'], summary: 'Paginated list of a master (key = branch, product, roi, ...)',
        parameters: [
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'per_page', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'active', in: 'query', schema: { type: 'string', enum: ['1'] } },
        ],
        responses: { 200: { description: 'Paginated master list (meta: page/per_page/total/total_pages)' } },
      },
      post: {
        tags: ['Masters'], summary: 'Create a master record',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 201: { description: 'Created' }, 400: { description: 'Validation error' } },
      },
    },
    '/masters/{key}/{id}': {
      get: { tags: ['Masters'], summary: 'Get a master record by id',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Record' }, 404: { description: 'Not found' } } },
      put: { tags: ['Masters'], summary: 'Update a master record',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Masters'], summary: 'Deactivate (logical delete) a master record',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Deactivated' } } },
    },
    '/enquiries': {
      get: { tags: ['Enquiries'], summary: 'List enquiries (search / filter / sort / paginate)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'per_page', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status_code', in: 'query', schema: { type: 'string' } },
          { name: 'assigned_to', in: 'query', schema: { type: 'integer' } },
          { name: 'sort', in: 'query', schema: { type: 'string' } },
          { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc','desc'] } },
        ],
        responses: { 200: { description: 'Paginated enquiries' } } },
      post: { tags: ['Enquiries'], summary: 'Create an enquiry (manual)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 201: { description: 'Created' }, 400: { description: 'Validation error' } } },
    },
    '/demo-requests': {
      post: {
        tags: ['Demo requests'], security: [], summary: 'Request a LoanDesk software demo',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name', 'email', 'company', 'interest'],
          properties: {
            name: { type: 'string', maxLength: 120 },
            email: { type: 'string', format: 'email', maxLength: 254 },
            company: { type: 'string', maxLength: 160 },
            interest: { type: 'string', enum: ['Full platform', 'Enquiries & applications', 'Underwriting workflow', 'Portfolio & servicing', 'Reporting & oversight'] },
            message: { type: 'string', maxLength: 2000 },
          },
        } } } },
        responses: {
          201: { description: 'Demo request stored; data contains request_ref', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          400: { description: 'Field validation or invalid JSON' },
          413: { description: 'Request body too large' },
          429: { description: 'Too many demo requests' },
          500: { description: 'Request could not be saved' },
        },
      },
    },
    '/enquiries/meta/form-options': {
      get: { tags: ['Enquiries'], summary: 'Reference lists for the enquiry form (branches, products, purposes, sources, brokers, applicant types, statuses, assignees)',
        responses: { 200: { description: 'Form options' } } },
    },
    '/enquiries/{id}': {
      get: { tags: ['Enquiries'], summary: 'Get an enquiry (with notes, assignment history, documents)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Enquiry' }, 404: { description: 'Not found' } } },
      put: { tags: ['Enquiries'], summary: 'Update an enquiry',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated' }, 400: { description: 'Validation error' } } },
    },
    '/enquiries/{id}/assign': {
      post: { tags: ['Enquiries'], summary: 'Assign / reassign the enquiry to a BDM (records history)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['assigned_to'], properties: { assigned_to: { type: 'integer' }, note: { type: 'string' } } } } } },
        responses: { 200: { description: 'Assigned' } } },
    },
    '/enquiries/{id}/status': {
      post: { tags: ['Enquiries'], summary: 'Change enquiry status via the central workflow engine',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' }, reason: { type: 'string' } } } } } },
        responses: { 200: { description: 'Status updated' }, 400: { description: 'Illegal transition' } } },
    },
    '/enquiries/{id}/notes': {
      get: { tags: ['Enquiries'], summary: 'List notes / activity timeline',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Notes' } } },
      post: { tags: ['Enquiries'], summary: 'Add a note',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } } } } },
        responses: { 201: { description: 'Note added' } } },
    },
    '/enquiries/{id}/convert-check': {
      get: { tags: ['Enquiries'], summary: 'Pre-flight convert check (returns missing mandatory fields)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Readiness + missing fields' } } },
    },
    '/enquiries/{id}/convert': {
      post: { tags: ['Enquiries'], summary: 'Convert enquiry to application (validates the configurable rule set)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 201: { description: 'Application created' }, 400: { description: 'Missing required fields' } } },
    },
    '/permissions': {
      get: { tags: ['Permissions'], summary: 'List all permissions (module_key.permission_key)', responses: { 200: { description: 'Permissions' } } },
    },
  },
};
