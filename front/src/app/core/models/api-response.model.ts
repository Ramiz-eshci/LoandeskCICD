/**
 * Uniform API envelope returned by EVERY endpoint (mirror of
 * api/services/response.service.js on the server):
 *
 *   { status, message, data, errors, meta }
 */
export interface ApiResponse<T = unknown> {
  status: boolean;
  /** Mirror of `status` (Module-1 point 7 { success } contract). */
  success?: boolean;
  message: string;
  data: T;
  errors: Record<string, unknown> | null;
  meta: ApiMeta | null;
  /** Per-request trace id echoed by the API (X-Correlation-Id). */
  correlationId?: string;
}

export interface ApiMeta {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
  /** typed crypto/error code, e.g. NO_CRYPTO_SESSION */
  code?: string;
  [k: string]: unknown;
}
