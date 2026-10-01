import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Cloud snapshot of the LAST PREPARED Pending-GRN report — the final result
 * the user generates with "Prepare Report", NOT the whole raw file.
 *
 * Stored as one row in `grn_snapshots` (keyed 'latest'), so after a reload or
 * on another device the console reopens straight on the prepared report with
 * the exact numbers from the last prepare run.
 */

const TABLE = "grn_snapshots";
const SNAPSHOT_KEY = "latest";
/** Above this the jsonb write gets slow/expensive — keep the result local-only. */
const MAX_SNAPSHOT_BYTES = 4_000_000;

export type GrnSnapshotParams = {
  startDate: string;
  endDate: string;
  taproot: boolean;
};

export type GrnSnapshot = {
  kind: "prepared";
  fileName: string;
  sheetName: string;
  generatedAt: string;
  paramsUsed: GrnSnapshotParams;
  funnel: {
    raw: number;
    afterZeroGr: number;
    afterDate: number;
    afterTaproot: number;
    afterSspl: number;
  };
  finalRowCount: number;
  overallDistinctDocs: number;
  plantRows: Array<{ zbh: string; plant: string; totalPendingGrn: number; oldestAging: number }>;
  filteredRows: (string | number)[][];
  filteredRowZbh: string[] | null;
  columnsForExport: string[];
  warnings: string[];
};

export type SnapshotSaveResult = { ok: boolean; skipped?: boolean; error?: string };

export async function saveGrnSnapshot(snapshot: GrnSnapshot): Promise<SnapshotSaveResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase is not configured." };
  let payload: string;
  try {
    payload = JSON.stringify(snapshot);
  } catch {
    return { ok: false, error: "Could not serialize the report." };
  }
  if (payload.length > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false,
      skipped: true,
      error: `Report is too large to store in the cloud (${Math.round(payload.length / 1_000_000)} MB) — kept in this browser only.`,
    };
  }
  try {
    // `rows` holds the whole versioned prepared payload (the table is a
    // private single-row store; see scripts/migration-grn-snapshots.sql).
    const { error } = await supabase.from(TABLE).upsert(
      {
        snapshot_key: SNAPSHOT_KEY,
        file_name: snapshot.fileName,
        sheet_name: snapshot.sheetName,
        columns: snapshot.columnsForExport,
        rows: snapshot,
        row_count: snapshot.finalRowCount,
        file_size: payload.length,
        uploaded_at: snapshot.generatedAt,
      },
      { onConflict: "snapshot_key" }
    );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Returns the last PREPARED snapshot, or null (missing/old-format/absent). */
export async function loadGrnSnapshot(): Promise<GrnSnapshot | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("rows")
      .eq("snapshot_key", SNAPSHOT_KEY)
      .maybeSingle();
    if (error || !data) return null;
    const payload = (data as { rows?: unknown }).rows;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      (payload as { kind?: unknown }).kind !== "prepared" ||
      !Array.isArray((payload as { filteredRows?: unknown }).filteredRows)
    ) {
      return null; // old raw-file format or junk — ignore it
    }
    return payload as unknown as GrnSnapshot;
  } catch {
    return null;
  }
}

export async function clearGrnSnapshot(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from(TABLE).delete().eq("snapshot_key", SNAPSHOT_KEY);
  } catch {
    // ignore — best effort
  }
}
