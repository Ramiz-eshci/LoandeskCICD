/**
 * Friendly message for a failed list / page load (client 29-09-2026).
 * Replaces the old "Sign in as System Administrator." text.
 *
 *   403 -> "You do not have permission to view <what>. Please contact your administrator."
 *   401 -> "Your session has expired. Please sign in again."
 *   0   -> "Cannot reach the server. Check your connection and try again."
 *   else-> "Could not load <what>. Please try again."
 */
export function loadErrorMessage(err: unknown, what: string): string {
  const status = Number((err as { status?: number } | null)?.status ?? -1);
  if (status === 403) return `You do not have permission to view ${what}. Please contact your administrator.`;
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 0) return 'Cannot reach the server. Check your connection and try again.';
  return `Could not load ${what}. Please try again.`;
}
