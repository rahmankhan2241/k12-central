/**
 * Academic session years used across the app.
 *
 * 2024-25 and 2025-26 are CLOSED sessions: once a session ends its historic
 * payment data is final and can never change. Their first-payment snapshots
 * (one row per ERP) are therefore fetched ONCE and stored permanently in
 * Supabase — the daily pipeline and the manual "Fetch Now" only ever run for
 * the LIVE session (2026-27). The frozen years are read from the stored
 * snapshot and never re-downloaded from Eduvate.
 */

/** Every academic year present in payment_report_rows, newest first. */
export const ALL_SESSION_YEARS = ["2026-27", "2025-26", "2024-25"] as const;

export type SessionYear = (typeof ALL_SESSION_YEARS)[number];

/** The live session — the only year the fetch pipeline is allowed to run for. */
export const LIVE_YEAR = "2026-27";

/**
 * Closed academic years whose snapshots are frozen. Their data is permanent,
 * so the pipeline must never overwrite them.
 */
export const FROZEN_YEARS: readonly string[] = ["2025-26", "2024-25"];

/** True when the year's snapshot is frozen (permanently saved, read-only). */
export function isFrozenYear(year: string): boolean {
  return FROZEN_YEARS.includes(year);
}
