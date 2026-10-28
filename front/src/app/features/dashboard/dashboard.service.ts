import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';

/**
 * Dashboard aggregates (api/routes/dashbord.routes.js).
 * Tiles are gated server-side by the caller's module permissions — a tile the
 * role may not see is ABSENT from the payload, never returned as zero.
 */
export interface DashboardTile {
  key: string;
  module: string;
  label: string;
  value: number;
  caption: string;
  icon: string;
  tone: 'default' | 'positive' | 'warning' | 'danger';
  format?: 'currency';
  /** true when the figure is narrowed to rows assigned to this user. */
  scoped: boolean;
}

export interface DashboardBar {
  code?: string;
  label: string;
  value: number;
}

export interface DashboardRecentApplication {
  application_id: number;
  application_ref: string;
  applicant_name: string;
  product_name: string;
  amount_requested: number;
  status_name: string | null;
  status_code: string | null;
  created_at: string;
  /** ui-data-table indexes rows by column key. */
  [key: string]: unknown;
}

export interface DashboardSummary {
  tiles: DashboardTile[];
  enquiry_pipeline?: DashboardBar[];
  product_mix?: DashboardBar[];
  underwriting_status?: DashboardBar[];
  maturity_buckets?: DashboardBar[];
  recent_applications?: DashboardRecentApplication[];
  context: {
    user_id: number | null;
    role_id: number | null;
    is_admin: boolean;
    any_scoped: boolean;
    generated_at: string;
  };
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.dashboard;

  summary(): Observable<DashboardSummary> {
    return this.http.get<ApiResponse<DashboardSummary>>(this.base).pipe(map((r) => r.data));
  }
}
