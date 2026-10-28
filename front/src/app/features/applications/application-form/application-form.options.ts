import { SegmentOption } from '../../../shared/ui/ui-segmented/ui-segmented.component';
import { WizardStep } from '../../../shared/ui/ui-wizard-steps/ui-wizard-steps.component';

/** Static picklists for the New Application wizard. */

export const APPLICATION_STEPS: WizardStep[] = [
  { key: 'applicant', label: 'Applicant & Parties' },
  { key: 'product', label: 'Product & Fees' },
  { key: 'request', label: 'Loan Request' },
  { key: 'financial', label: 'Financial Information' },
  { key: 'security', label: 'Security' },
  { key: 'documents', label: 'Documents' },
  { key: 'kyc', label: 'KYC / AML' },
  { key: 'structure', label: 'Loan Structure' },
  { key: 'review', label: 'Review & Submit' },
];

export const APPLICANT_TYPES: SegmentOption[] = [
  { key: 'individual', label: 'Individual' },
  { key: 'company', label: 'Company' },
  { key: 'joint', label: 'Joint' },
  { key: 'multi-party', label: 'Multi-Party' },
];

export const PRODUCTS: SegmentOption[] = [
  { key: 'bridge', label: 'Bridge Loan' },
  { key: 'development', label: 'Development Finance' },
  { key: 'term', label: 'Term Loan' },
  { key: 'commercial', label: 'Commercial Loan' },
];

export const LOAN_PURPOSES: SegmentOption[] = [
  { key: 'purchase', label: 'Purchase' },
  { key: 'refinance', label: 'Refinance' },
  { key: 'development', label: 'Development' },
  { key: 'working-capital', label: 'Working Capital' },
  { key: 'bridge-to-sale', label: 'Bridge to Sale' },
  { key: 'auction', label: 'Auction Purchase' },
];

export const EXIT_STRATEGIES = [
  'Sale of property',
  'Refinance to buy-to-let mortgage',
  'Sale of business',
  'Development sale / GDV',
  'Other',
];

export const CREDIT_SCORES: SegmentOption[] = [
  { key: 'excellent', label: 'Excellent' },
  { key: 'good', label: 'Good' },
  { key: 'fair', label: 'Fair' },
  { key: 'poor', label: 'Poor' },
  { key: 'very-poor', label: 'Very Poor' },
];

export const BANKRUPTCY_OPTIONS: SegmentOption[] = [
  { key: 'no', label: 'No' },
  { key: 'discharged', label: 'Yes — discharged' },
  { key: 'current', label: 'Yes — current' },
];

export const TENURES: SegmentOption[] = [
  { key: 'freehold', label: 'Freehold' },
  { key: 'leasehold', label: 'Leasehold' },
  { key: 'commonhold', label: 'Commonhold' },
];

export const TITLES: SegmentOption[] = [
  { key: 'registered', label: 'Registered' },
  { key: 'unregistered', label: 'Unregistered' },
];

export const CHARGE_OPTIONS: SegmentOption[] = [
  { key: 'first', label: 'Yes' },
  { key: 'second', label: 'No — second charge' },
];

export const SCREENING_OPTIONS: SegmentOption[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'clear', label: 'Clear' },
  { key: 'match', label: 'Match Found' },
];

export const REQUIRED_DOCUMENTS = [
  'Photo ID (Passport / Driving Licence)',
  'Proof of Address (< 3 months)',
  'Bank Statements (3 months)',
  'Evidence of Income / Accounts',
  'Property Details / Particulars',
  'Proof of Deposit / Equity',
];
