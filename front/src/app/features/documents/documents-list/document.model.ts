import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';
import { TagTone } from '../../../shared/ui/ui-tag/ui-tag.component';

export interface LoanDocument {
  name: string;
  category: string;
  categoryKey: string;
  linkedRecord: string;
  version: string;
  uploadedBy: string;
  uploadedDate: string;
  verified: string;
  verifiedTone: TagTone;
  expiry: string | null;
  statusKey: string;
  status: string;
  statusTone: BadgeStatus;
  [key: string]: unknown;
}
