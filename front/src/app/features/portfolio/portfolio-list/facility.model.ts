import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';

export interface FacilityPrompt { label: string; tone: 'payment' | 'contact' | 'redemption'; title: string; }

export interface Facility {
  id: string;
  customer: string;
  product: string;
  balance: string;
  rate: string;
  maturity: string;
  arrears: string;
  inArrears: boolean;
  status: string;
  statusTone: BadgeStatus;
  prompts?: FacilityPrompt[];
  [key: string]: unknown;
}

export interface PortfolioCustomer {
  id: string;
  applicantId: number;
  name: string;
  type: string;
  branch: string;
  facilities: number;
  applications: number;
  created: string;
  exposure: string;
  arrears: string;
  inArrears: boolean;
  [key: string]: unknown;
}
