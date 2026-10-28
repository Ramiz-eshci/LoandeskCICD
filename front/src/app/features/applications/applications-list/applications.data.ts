import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { ApplicationStageKey, LoanApplication } from './application.model';

/** Design-stage sample data. */
export const APPLICATIONS: LoanApplication[] = [
  {
    id: 'APP-000458',
    applicant: 'John Smith',
    applicantCompany: null,
    product: 'Bridge Loan',
    grossAmount: '£243,000',
    term: '12m',
    ltv: '68%',
    bdm: 'Sarah',
    underwriter: 'Daniel Hayes',
    stageKey: 'underwriting',
    status: 'Underwriting',
    statusTone: 'review',
    initialOffer: 'Indicative F/Up',
    initialOfferTone: 'warning',
    sla: '2 days',
    slaTone: 'ok',
  },
  {
    id: 'APP-000457',
    applicant: 'Harrison Properties Ltd',
    applicantCompany: 'Harrison Properties Ltd',
    product: 'Development Finance',
    grossAmount: '£1,250,000',
    term: '18m',
    ltv: '72%',
    bdm: 'Sarah',
    underwriter: 'Daniel Hayes',
    stageKey: 'credit-review',
    status: 'Credit Review',
    statusTone: 'pending',
    initialOffer: 'Chasing (30d)',
    initialOfferTone: 'warning',
    sla: '1 day',
    slaTone: 'ok',
  },
];

export const APPLICATION_STAGES: { key: ApplicationStageKey | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awaiting-review', label: 'Awaiting Initial Review' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'underwriting', label: 'Underwriting' },
  { key: 'approved', label: 'Approved' },
  { key: 'completed', label: 'Completed' },
  { key: 'declined', label: 'Declined' },
];

export const APPLICATION_COLUMNS: TableColumn<LoanApplication>[] = [
  { key: 'id', header: 'Application', width: '120px', mono: true, bold: true },
  { key: 'applicant', header: 'Applicant', width: '150px' },
  { key: 'product', header: 'Product', width: '140px' },
  { key: 'grossAmount', header: 'Gross Amount', width: '125px', mono: true, bold: true },
  { key: 'term', header: 'Term', width: '65px' },
  { key: 'ltv', header: 'LTV', width: '65px' },
  { key: 'bdm', header: 'BDM', width: '75px' },
  { key: 'underwriter', header: 'Underwriter', width: '125px' },
  { key: 'status', header: 'Status', width: '125px' },
  { key: 'initialOffer', header: 'Initial Offer', width: '125px' },
  { key: 'sla', header: 'SLA', width: '80px' },
  { key: 'actions', header: 'Actions', width: '90px' },
];
