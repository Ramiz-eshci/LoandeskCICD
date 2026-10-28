import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';

export type ValuationStatusKey = 'instructed' | 'report-received' | 'under-review' | 'accepted' | 'rejected';

export interface Valuation {
  ref: string;
  applicationId: string;
  address: string;
  valuer: string;
  type: string;
  instructionDate: string;
  reportDate: string | null;
  marketValue: string | null;
  gdv: string | null;
  ltv: string;
  statusKey: ValuationStatusKey;
  status: string;
  statusTone: BadgeStatus;
  id?: number;
  application_id?: number;
  // report popup (raw values)
  market_value?: number | string | null;
  gdv_value?: number | string | null;
  condition_rating?: number | string | null;
  special_assumptions?: string | null;
  recommendation?: string | null;
  valuation_result?: string | null;
  /** Completed valuations sit under the second tab. */
  completed: boolean;
  [key: string]: unknown;
}
