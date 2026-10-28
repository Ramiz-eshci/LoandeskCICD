/** Mirrors api/controllers/access.controller.js payloads. */
export interface Role {
  role_id: number;
  role_name: string;
  description: string | null;
  is_active: boolean | number;
  [key: string]: unknown;
}

/** One permission = one module + one action (module-wise RBAC). */
export interface PermissionDef {
  permission_id: number;
  module_key: string;
  permission_key: string;
  description?: string | null;
}

/** Dynamic module/screen from the modules master (sheet-driven). */
export interface ModuleDef {
  module_id: number;
  module_code: string;
  module_name: string;
  parent_code: string | null;
  sort_order: number;
}
