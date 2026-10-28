import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { UnderwritingCase } from './underwriting.model';

/** Design-stage sample data (mirrors the Figma Underwriting Work Queue). */
export const UW_CASES: UnderwritingCase[] = [
  { id: 'APP-000458', applicant: 'John Smith', product: 'Bridge Loan', amount: '£243,000', ltv: '68%', statusKey: 'underwriting', status: 'Underwriting', sla: '2 days', slaBreach: false, mine: true },
  { id: 'APP-000454', applicant: 'Rachel & Thomas Green', product: 'Bridge Loan', amount: '£385,000', ltv: '77%', statusKey: 'info-required', status: 'Information Required', sla: 'Breach', slaBreach: true, mine: true },
  { id: 'APP-000449', applicant: 'Meridian Estates Ltd', product: 'Development Finance', amount: '£1,250,000', ltv: '62%', statusKey: 'referred', status: 'Referred', sla: '1 day', slaBreach: false, mine: false },
  { id: 'APP-000441', applicant: 'Priya Sharma', product: 'Buy to Let', amount: '£180,000', ltv: '70%', statusKey: 'recommended', status: 'Recommended', sla: '3 days', slaBreach: false, mine: true },
];

export const UW_COLUMNS: TableColumn<UnderwritingCase>[] = [
  { key: 'id', header: 'Application', width: '130px', mono: true, bold: true },
  { key: 'applicant', header: 'Applicant', width: '190px' },
  { key: 'product', header: 'Product', width: '160px' },
  { key: 'amount', header: 'Amount', width: '120px', mono: true, bold: true },
  { key: 'ltv', header: 'LTV', width: '80px', mono: true },
  { key: 'status', header: 'Status', width: '160px' },
  { key: 'sla', header: 'SLA', width: '100px' },
  { key: 'actions', header: 'Actions', width: '190px' },
];
