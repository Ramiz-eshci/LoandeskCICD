export type AuditCategory = 'security' | 'data' | 'config';

export interface AuditEntry {
  timestamp: string;
  user: string;
  module: string;
  action: string;
  entity: string;
  ip: string;
  category: AuditCategory;
  [key: string]: unknown;
}
