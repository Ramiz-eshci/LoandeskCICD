import { BarGroup, BarSeries } from '../../../shared/ui/charts/ui-bar-chart.component';
import { BarListItem } from '../../../shared/ui/charts/ui-bar-list.component';
import { LineSeries } from '../../../shared/ui/charts/ui-line-chart.component';
import { PillTab } from '../../../shared/ui/ui-pill-tabs/ui-pill-tabs.component';
import { ReportDefinition } from './report.model';

export const REPORT_CATEGORIES: PillTab[] = [
  { key: 'executive', label: 'Executive', icon: 'bi-bar-chart-line' },
  { key: 'sales', label: 'Sales', icon: 'bi-graph-up-arrow' },
  { key: 'underwriting', label: 'Underwriting', icon: 'bi-clipboard-check' },
  { key: 'portfolio', label: 'Portfolio', icon: 'bi-window-stack' },
  { key: 'collections', label: 'Collections', icon: 'bi-people' },
];

export interface ReportKpi {
  label: string;
  value: string;
  caption: string;
}

export const REPORT_KPIS: ReportKpi[] = [
  { label: 'Pipeline value', value: '£8.2M', caption: 'Active enquiries' },
  { label: 'YTD completions', value: '47', caption: 'Jan–Aug 2026' },
  { label: 'Avg LTV', value: '67.3%', caption: 'Portfolio weighted' },
  { label: 'Portfolio yield', value: '8.4% IRR', caption: 'Portfolio average' },
];

export const PIPELINE_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

export const PIPELINE_SERIES: LineSeries[] = [
  { name: 'Applications', color: '#0f2244', values: [34, 41, 38, 52, 49, 61], area: true },
  { name: 'Approvals', color: '#eaab00', values: [18, 24, 21, 31, 28, 37], area: true },
  { name: 'Enquiries', color: '#a8bed6', values: [46, 55, 51, 68, 63, 76], area: true },
];

export const PRODUCT_MIX: BarListItem[] = [
  { label: 'Bridge Loan', value: 58, color: '#0f2244' },
  { label: 'Dev Finance', value: 24, color: '#eaab00' },
  { label: 'Term Loan', value: 12, color: '#1e3a5f' },
  { label: 'Commercial', value: 6, color: '#a8bed6' },
];

export const BRANCH_SERIES: BarSeries[] = [
  { name: 'Applications', color: '#a8bed6' },
  { name: 'Enquiries', color: '#0f2244' },
];

export const BRANCH_DATA: BarGroup[] = [
  { label: 'London', values: [34, 21] },
  { label: 'Manchester', values: [26, 16] },
  { label: 'Birmingham', values: [19, 11] },
  { label: 'Head Office', values: [12, 7] },
];

export const REPORTS: ReportDefinition[] = [
  {
    title: 'Enquiry Pipeline Dashboard',
    description: 'High-level enquiry and application pipeline overview',
    type: 'Dashboard',
    typeTone: 'dashboard',
    category: 'executive',
  },
  {
    title: 'Approval Rate',
    description: 'Application approval rate vs industry benchmarks',
    type: 'KPI',
    typeTone: 'kpi',
    category: 'executive',
  },
  {
    title: 'Portfolio Overview',
    description: 'Book value, growth and composition by product',
    type: 'Dashboard',
    typeTone: 'dashboard',
    category: 'executive',
  },
  {
    title: 'Exposure Report',
    description: 'Total lending exposure by product, region and risk grade',
    type: 'Risk',
    typeTone: 'risk',
    category: 'executive',
  },
  {
    title: 'Arrears & Bad Debt',
    description: 'Arrears rate, provisions and write-off history',
    type: 'Risk',
    typeTone: 'risk',
    category: 'executive',
  },
  {
    title: 'Branch Performance',
    description: 'Revenue, applications and portfolio by branch',
    type: 'Performance',
    typeTone: 'performance',
    category: 'executive',
  },
  {
    title: 'Product Performance',
    description: 'Yield, volume and arrears by product type',
    type: 'Performance',
    typeTone: 'performance',
    category: 'executive',
  },
  {
    title: 'Conversion Funnel',
    description: 'Enquiry to completion conversion by source and BDM',
    type: 'Performance',
    typeTone: 'performance',
    category: 'sales',
  },
  {
    title: 'Broker League Table',
    description: 'Introduced volume, conversion and quality by broker',
    type: 'Performance',
    typeTone: 'performance',
    category: 'sales',
  },
  {
    title: 'Decision Turnaround',
    description: 'Time to decision across underwriting and credit',
    type: 'KPI',
    typeTone: 'kpi',
    category: 'underwriting',
  },
  {
    title: 'Credit Risk Grades',
    description: 'Distribution of risk grades across new lending',
    type: 'Risk',
    typeTone: 'risk',
    category: 'underwriting',
  },
  {
    title: 'Maturity Ladder',
    description: 'Facilities maturing by month with redemption forecast',
    type: 'Dashboard',
    typeTone: 'dashboard',
    category: 'portfolio',
  },
  {
    title: 'Yield Analysis',
    description: 'Net yield and IRR by product and vintage',
    type: 'KPI',
    typeTone: 'kpi',
    category: 'portfolio',
  },
  {
    title: 'Arrears Ageing',
    description: 'Arrears balances bucketed by days past due',
    type: 'Risk',
    typeTone: 'risk',
    category: 'collections',
  },
  {
    title: 'Recovery Performance',
    description: 'Recovered balances and cure rates by collections stage',
    type: 'Performance',
    typeTone: 'performance',
    category: 'collections',
  },
];
