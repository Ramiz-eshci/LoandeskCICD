export type ReportCategory = 'executive' | 'sales' | 'underwriting' | 'portfolio' | 'collections';
export type ReportTypeTone = 'dashboard' | 'kpi' | 'risk' | 'performance';

export interface ReportDefinition {
  title: string;
  description: string;
  type: string;
  typeTone: ReportTypeTone;
  category: ReportCategory;
}
