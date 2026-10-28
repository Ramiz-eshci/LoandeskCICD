/** Shapes exchanged with /api/auth (mirror of api/controllers/auth.controller.js). */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  userId: number | string;
  email: string;
  /** users.full_name — display name for the header / account menu (may be null). */
  fullName?: string | null;
  /** users.avatar — profile picture (data URL) or null for initials. */
  avatar?: string | null;
  roleId: number | string;
  isSuperAdmin: boolean;
  isCompanyAdmin: boolean;
}

/** A role assigned to the user (drives the "Select Your Workspace" screen). */
export interface RoleOption {
  roleId: number;
  roleName: string;
  isPrimary: boolean;
  /** Branch name for this workspace card (from the user's branch). */
  branchName?: string | null;
  /** UTC timestamp this role was last entered; null if never. */
  lastAccessedAt?: string | null;
}

/** Step-1 login response: an OTP challenge (no session issued yet). */
export interface LoginChallenge {
  challengeId: string;
  otpRequired: boolean;
  defaultOtp: boolean;
  otpLength: number;
  expiresInSeconds: number;
  /** Delivery channels the code was sent on: 'mobile' | 'email'. */
  channels?: string[];
  /** Masked recipients for display on the MFA screen. */
  maskedEmail?: string | null;
  maskedMobile?: string | null;
  /** Dev-only: the fixed default OTP (never present in production). */
  devOtp?: string;
}

/** Response of POST /auth/resend-otp. */
export interface ResendResponse {
  challengeId: string;
  otpLength: number;
  expiresInSeconds: number;
  channels?: string[];
  maskedEmail?: string | null;
  maskedMobile?: string | null;
  devOtp?: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
  /** true when the user holds more than one role and must pick a workspace. */
  requiresRoleSelection: boolean;
  activeRoleId: number | null;
  roles: RoleOption[];
  /** Flat "MODULE.action" permission keys for the active role. */
  permissions: string[];
}

/** Response of POST /auth/select-role. */
export interface SelectRoleResponse {
  accessToken: string;
  activeRoleId: number;
  permissions: string[];
}

/** Response of GET /auth/me. */
export interface MeResponse extends AuthUser {
  activeRoleId: number | null;
  roles: RoleOption[];
  permissions: string[];
}
