import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../../core/models/api-response.model';

/** One broker + the business it introduced (api/services/broker.service.js). */
export interface BrokerStatRow {
  broker_id: number;
  code: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  fca_number: string | null;
  commission_pct: number | null;
  is_active: boolean | number;
  enquiries: number;
  enquiry_value: number;
  last_enquiry_at: string | null;
  applications: number;
  underwriting?: number;
  completions: number;
  portfolio_total: number;
  live_balance: number;
  avg_rate_pct: number | null;
  conversion_pct: number | null;
}
export interface BrokerStatTotals {
  brokers: number; enquiries: number; applications: number; completions: number;
  portfolio_total: number; live_balance: number;
}

/* ---- Broker dashboard (client 22-10-2026) ---- */
export interface BrokerProfile {
  broker_id: number; code: string | null; name: string; company: string | null; email: string | null;
  phone: string | null; fca_number: string | null; address: string | null; commission_pct: number | null;
  is_active: boolean | number; created_at: string | null;
}
export interface BrokerSummary {
  enquiries: number; enquiry_value: number; quoted: number; declined: number;
  applications: number; application_value: number; underwriting: number;
  completions: number; portfolio_total: number; live_facilities: number; live_balance: number;
  avg_loan: number; avg_rate_pct: number | null; conversion_pct: number | null; broker_fees: number;
  first_enquiry_at: string | null; last_enquiry_at: string | null; has_signed_agreement: boolean;
  /** Client 23-10-2026: completions = Redeemed (matured & paid off); funded = every loan. */
  completed_value?: number; funded?: number; portfolio_gross?: number; portfolio_net?: number;
  live_gross?: number; live_net?: number;
  journey?: { label: string; count: number; value: number }[];
  loan_progress?: { label: string; value: number }[];
}
export interface BrokerEnquiry { enquiry_id: number; enquiry_ref: string; customer: string | null; status: string; amount: number; bdm: string; created_at: string }
export interface BrokerApplication {
  application_id: number; application_ref: string; customer: string | null; product: string; amount_requested: number | null;
  status: string; uw_status: string | null; underwriting_case_id: number | null; bdm: string; created_at: string; broker_fee: number | null;
}
export interface BrokerFacility {
  loan_id: number; loan_number: string; customer: string; product: string; principal: number; outstanding_balance: number | null;
  rate_pct: number; start_date: string | null; maturity_date: string | null; status: string;
}
export interface BrokerDocument { doc_id: number; document_type: string | null; file_name: string; notes: string | null; expiry_date: string | null; created_at: string; uploaded_by_name: string }
export interface BrokerDetail {
  profile: BrokerProfile; summary: BrokerSummary; enquiries: BrokerEnquiry[]; applications: BrokerApplication[];
  facilities: BrokerFacility[]; documents: BrokerDocument[]; documentTypes: string[];
}

/** Brokers menu (client 20-10-2026): broker performance. Add / edit uses the Broker master. */
@Injectable({ providedIn: 'root' })
export class BrokersService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + '/brokers';

  stats(search?: string): Observable<{ rows: BrokerStatRow[]; totals: BrokerStatTotals }> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<ApiResponse<{ rows: BrokerStatRow[]; totals: BrokerStatTotals }>>(`${this.base}/stats`, { params })
      .pipe(map((r) => r.data));
  }

  detail(id: number | string): Observable<BrokerDetail> {
    return this.http.get<ApiResponse<BrokerDetail>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }
  uploadDocument(id: number, body: { file_name: string; content_base64: string; document_type: string }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/documents`, body).pipe(map((r) => r.data));
  }
  downloadDocument(id: number, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/documents/${docId}/download`, { responseType: 'blob' });
  }
  deleteDocument(id: number, docId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/${id}/documents/${docId}`);
  }
}
