/** Mirrors api/controllers/user.controller.js + access.controller.js payloads. */
export interface AdminUser {
  user_id: number;
  email: string;
  full_name: string | null;
  role_id: number | null;
  is_active: boolean | number;
  is_super_admin: boolean | number;
  [key: string]: unknown;
}

export interface AdminRole {
  role_id: number;
  role_name: string;
  description: string | null;
  is_active: boolean | number;
  [key: string]: unknown;
}
