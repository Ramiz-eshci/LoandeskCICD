import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { AuditEntry } from './audit.model';

/** Design-stage sample data (Audit Trail / Compliance). */
export const AUDIT_ENTRIES: AuditEntry[] = [
  { timestamp: '24 Aug 2026 08:42:11', user: 'sarah@esh.co.uk', module: 'APPLICATION', action: 'UPDATE', entity: 'APP-000458', ip: '10.0.2.51', category: 'data' },
  { timestamp: '24 Aug 2026 08:39:02', user: 'admin@loandesk.local', module: 'ROLE', action: 'PERMISSIONS_SET', entity: 'Role #4', ip: '10.0.2.10', category: 'config' },
  { timestamp: '24 Aug 2026 08:31:55', user: 'unknown', module: 'AUTH', action: 'LOGIN_FAILED', entity: 'jane@esh.co.uk', ip: '82.14.9.3', category: 'security' },
  { timestamp: '24 Aug 2026 08:20:07', user: 'david@esh.co.uk', module: 'UNDERWRITING', action: 'APPROVE', entity: 'APP-000441', ip: '10.0.2.62', category: 'data' },
];

export const AUDIT_COLUMNS: TableColumn<AuditEntry>[] = [
  { key: 'timestamp', header: 'Timestamp', width: '180px', mono: true },
  { key: 'user', header: 'User', width: '200px' },
  { key: 'module', header: 'Module', width: '150px' },
  { key: 'action', header: 'Action', width: '160px' },
  { key: 'entity', header: 'Entity', width: '150px', mono: true },
  { key: 'ip', header: 'IP Address', width: '130px', mono: true },
];
