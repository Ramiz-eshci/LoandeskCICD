import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { Facility, PortfolioCustomer } from './facility.model';

/** Design-stage sample data. */
export const FACILITIES: Facility[] = [
  {
    id: 'FAC-001234',
    customer: 'John Smith',
    product: 'Bridge Loan',
    balance: '£243,000',
    rate: '1.05% pm',
    maturity: '01 Sep 2027',
    arrears: 'None',
    inArrears: false,
    status: 'Active',
    statusTone: 'active',
  },
  {
    id: 'FAC-001233',
    customer: 'Lakeside Holdings Ltd',
    product: 'Term Loan',
    balance: '£436,212',
    rate: '0.95% pm',
    maturity: '01 Aug 2028',
    arrears: 'None',
    inArrears: false,
    status: 'Active',
    statusTone: 'active',
  },
  {
    id: 'FAC-001228',
    customer: 'Premier Retail Ltd',
    product: 'Commercial Loan',
    balance: '£286,842',
    rate: '1% pm',
    maturity: '15 Jun 2027',
    arrears: '£1',
    inArrears: true,
    status: 'Arrears',
    statusTone: 'overdue',
  },
  {
    id: 'FAC-001215',
    customer: 'Nexus Developments Ltd',
    product: 'Development Finance',
    balance: '£612,000',
    rate: '1.15% pm',
    maturity: '10 Jan 2027',
    arrears: 'None',
    inArrears: false,
    status: 'Maturing Soon',
    statusTone: 'pending',
  },
];

export const PORTFOLIO_CUSTOMERS: PortfolioCustomer[] = [
  { id: 'CUST-000112', applicantId: 112, name: 'Lakeside Holdings Ltd', type: 'Company', branch: 'London Branch', facilities: 1, applications: 1, created: '22 Aug 2026', exposure: '£436,212', arrears: 'None', inArrears: false },
  { id: 'CUST-000108', applicantId: 108, name: 'TBM Capital Ltd', type: 'Company', branch: 'Head Office', facilities: 1, applications: 1, created: '20 Aug 2026', exposure: '£560,000', arrears: 'None', inArrears: false },
  { id: 'CUST-000104', applicantId: 104, name: 'Premier Retail Ltd', type: 'Company', branch: 'Manchester Branch', facilities: 1, applications: 1, created: '18 Aug 2026', exposure: '£286,842', arrears: '£1', inArrears: true },
  { id: 'CUST-000101', applicantId: 101, name: 'Nexus Developments Ltd', type: 'Company', branch: 'London Branch', facilities: 1, applications: 1, created: '15 Aug 2026', exposure: '£612,000', arrears: 'None', inArrears: false },
];

export const FACILITY_COLUMNS: TableColumn<Facility>[] = [
  { key: 'id', header: 'Facility ID', width: '130px', mono: true, bold: true },
  { key: 'customer', header: 'Customer', width: '200px' },
  { key: 'product', header: 'Product', width: '165px' },
  { key: 'balance', header: 'Balance', width: '125px', mono: true, bold: true },
  { key: 'rate', header: 'Rate', width: '110px', mono: true },
  { key: 'maturity', header: 'Maturity', width: '120px' },
  { key: 'status', header: 'Status', width: '140px' },
  { key: 'actions', header: 'Actions', width: '90px' },
];

/** Today tab columns — adds a "Today" column showing what needs action today (call / payment / maturity). */
export const TODAY_FACILITY_COLUMNS: TableColumn<Facility>[] = [
  { key: 'id', header: 'Facility ID', width: '130px', mono: true, bold: true },
  { key: 'customer', header: 'Customer', width: '190px' },
  { key: 'product', header: 'Product', width: '150px' },
  { key: 'balance', header: 'Balance', width: '120px', mono: true, bold: true },
  { key: 'rate', header: 'Rate', width: '95px', mono: true },
  { key: 'maturity', header: 'Maturity', width: '120px' },
  { key: 'today', header: 'Today', width: '210px' },
  { key: 'status', header: 'Status', width: '120px' },
  { key: 'actions', header: 'Actions', width: '90px' },
];

export const PORTFOLIO_CUSTOMER_COLUMNS: TableColumn<PortfolioCustomer>[] = [
  { key: 'id', header: 'Customer ID', width: '140px', mono: true, bold: true },
  { key: 'name', header: 'Name', width: '220px' },
  { key: 'type', header: 'Type', width: '110px' },
  { key: 'branch', header: 'Branch', width: '150px' },
  { key: 'facilities', header: 'Facilities', width: '100px' },
  { key: 'applications', header: 'Applications', width: '110px' },
  { key: 'created', header: 'Created', width: '120px' },
  { key: 'actions', header: 'Actions', width: '100px' },
];

export interface MaturityBucket {
  label: string;
  count: string;
  caption: string;
  tone: 'danger' | 'warning' | 'default';
}

export const MATURITY_BUCKETS: MaturityBucket[] = [
  { label: 'Maturing ≤ 30 days', count: '3 facilities', caption: '£4.8M at maturity', tone: 'danger' },
  { label: 'Maturing ≤ 60 days', count: '5 facilities', caption: '£7.2M at maturity', tone: 'warning' },
  { label: 'Maturing ≤ 90 days', count: '8 facilities', caption: '£10.1M at maturity', tone: 'default' },
];
