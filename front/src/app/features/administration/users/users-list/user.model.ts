export interface AdminUser {
  user_id: number;
  email: string;
  full_name: string | null;
  role_id: number | null;
  is_active: boolean | number;
  is_super_admin: boolean | number;
  roles?: { role_id: number; role_name: string; is_primary: boolean | number }[];
  roles_text?: string | null;
  [key: string]: unknown;
}

export interface RoleOption {
  role_id: number;
  role_name: string;
  description?: string | null;
  is_active?: boolean | number;
}
