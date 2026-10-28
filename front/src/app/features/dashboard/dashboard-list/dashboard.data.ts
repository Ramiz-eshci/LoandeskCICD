import { BarGroup, BarSeries } from '../../../shared/ui/charts/ui-bar-chart.component';
import { DonutSlice } from '../../../shared/ui/charts/ui-donut-chart.component';
import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';

/** Design-stage sample data. Swap for DashboardService results when the API lands. */

export interface KpiTile {
  label: string;
  value: string;
  caption: string;
  delta?: string;
  icon: string;
  tone: 'default' | 'positive' | 'warning' | 'danger';
}

export const KPI_TILES: KpiTile[] = [
  {
    label: 'New Enquiries',
    value: '31',
    caption: 'This month',
    delta: '12% vs last month',
    icon: 'bi-file-earmark-text',
    tone: 'default',
  },
  {
    label: 'Applications Active',
    value: '8',
    caption: 'In progress',
    icon: 'bi-file-earmark-text',
    tone: 'default',
  },
  {
    label: 'Approved This Month',
    value: '5',
    caption: '£1.42M value',
    delta: '8% vs last month',
    icon: 'bi-check2-circle',
    tone: 'positive',
  },
  {
    label: 'Outstanding Docs',
    value: '7',
    caption: 'Across 3 cases',
    icon: 'bi-exclamation-triangle',
    tone: 'warning',
  },
];

export const PIPELINE_SERIES: BarSeries[] = [
  { name: 'Enquiries', color: '#c3d5e8' },
  { name: 'Applications', color: '#0f2244' },
  { name: 'Approved', color: '#eaab00' },
];

export const PIPELINE_DATA: BarGroup[] = [
  { label: 'Mar', values: [18, 11, 8] },
  { label: 'Apr', values: [22, 15, 10] },
  { label: 'May', values: [19, 12, 9] },
  { label: 'Jun', values: [26, 18, 14] },
  { label: 'Jul', values: [24, 16, 11] },
  { label: 'Aug', values: [31, 21, 17] },
];

export const PRODUCT_MIX: DonutSlice[] = [
  { label: 'Bridge Loan', color: '#0f2244', value: 42 },
  { label: 'Commercial', color: '#a8bed6', value: 18 },
  { label: 'Development Finance', color: '#eaab00', value: 28 },
  { label: 'Term Loan', color: '#1e3a5f', value: 12 },
];

export interface RecentApplication {
  id: string;
  applicant: string;
  product: string;
  amount: string;
  status: string;
  statusTone: BadgeStatus;
  sla: string;
  slaTone: 'ok' | 'warn' | 'breach';
  [key: string]: unknown;
}

export const RECENT_APPLICATIONS: RecentApplication[] = [
  {
    id: 'APP-000458',
    applicant: 'John Smith',
    product: 'Bridge Loan',
    amount: '£243,000',
    status: 'Underwriting',
    statusTone: 'active',
    sla: '2 days',
    slaTone: 'ok',
  },
  {
    id: 'APP-000457',
    applicant: 'Harrison Properties Ltd',
    product: 'Development Finance',
    amount: '£1,250,000',
    status: 'Credit Approval',
    statusTone: 'active',
    sla: '1 day',
    slaTone: 'ok',
  },
  {
    id: 'APP-000456',
    applicant: 'Lakeside Holdings Ltd',
    product: 'Term Loan',
    amount: '£450,000',
    status: 'Legal',
    statusTone: 'active',
    sla: 'OK',
    slaTone: 'ok',
  },
  {
    id: 'APP-000455',
    applicant: 'TBM Capital Ltd',
    product: 'Bridge Loan',
    amount: '£560,000',
    status: 'Completed',
    statusTone: 'completed',
    sla: 'OK',
    slaTone: 'ok',
  },
  {
    id: 'APP-000454',
    applicant: 'Rachel & Thomas Green',
    product: 'Bridge Loan',
    amount: '£385,000',
    status: 'Information Required',
    statusTone: 'declined',
    sla: 'BREACH',
    slaTone: 'breach',
  },
];

export const RECENT_APPLICATION_COLUMNS: TableColumn<RecentApplication>[] = [
  { key: 'id', header: 'ID', width: '130px', mono: true, bold: true },
  { key: 'applicant', header: 'Applicant', bold: true },
  { key: 'product', header: 'Product' },
  { key: 'amount', header: 'Amount', width: '130px', mono: true, bold: true },
  { key: 'status', header: 'Status', width: '170px' },
  { key: 'sla', header: 'SLA', width: '90px' },
];
