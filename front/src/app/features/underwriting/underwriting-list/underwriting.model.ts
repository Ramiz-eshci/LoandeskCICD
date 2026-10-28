export type UwStatusKey = 'underwriting' | 'info-required' | 'referred' | 'recommended';

export interface UnderwritingCase {
  id: string;
  applicant: string;
  product: string;
  amount: string;
  ltv: string;
  statusKey: UwStatusKey;
  status: string;
  sla: string;
  slaBreach: boolean;
  mine: boolean;
  [key: string]: unknown;
}
