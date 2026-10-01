import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Cloud snapshot of the LAST uploaded Pending-GRN file.
 *
 * The parsed file is stored as one row in `grn_snapshots` (keyed 'latest'), so
 * the report — and Ask AI — still work after a reload, on another device, or
 * when the file only ever existed in browser memory.
 *
 * The payload is the parsed matrix (columns + rows of strings), NOT the raw
 * file, so restoring needs no XLSX parsing and the table stays small.
 */

const TABLE = "grn_snapshots";
const SNAPSHOT_KEY = "latest";
/** Above this the jsonb write gets slow/expensive — keep the page local-only. */
const MAX_SNAPSHOT_BYTES = 4_000_000;

export type GrnSnapshot = {
  fileName: string;
  sheetName: string;
  columns: string[];
  rows: string[][];
  rowCount: number;
  fileSize: number;
  /** ISO timestamp of the original upload. */
  uploadedAt: string;
};

export type SnapshotSaveResult = { ok: boolean; skipped?: boolean; error?: string };

export async function saveGrnSnapshot(snapshot: GrnSnapshot): Promise<SnapshotSaveResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase is not configured." };
  let payload: string;
  try {
    payload = JSON.stringify(snapshot.rows);
  } catch {
    return { ok: false, error: "Could not serialize the file." };
  }
  if (payload.length > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false,
      skipped: true,
      error: `File is too large to store in the cloud (${Math.round(payload.length / 1_000_000)} MB) — kept in this browser only.`,
    };
  }
  try {
    const { error } = await supabase.from(TABLE).upsert(
      {
        snapshot_key: SNAPSHOT_KEY,
        file_name: snapshot.fileName,
        sheet_name: snapshot.sheetName,
        columns: snapshot.columns,
        rows: snapshot.rows,
        row_count: snapshot.rowCount,
        file_size: snapshot.fileSize,
        uploaded_at: snapshot.uploadedAt,
      },
      { onConflict: "snapshot_key" }
    );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadGrnSnapshot(): Promise<GrnSnapshot | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("snapshot_key", SNAPSHOT_KEY)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      file_name?: string;
      sheet_name?: string;
      columns?: unknown;
      rows?: unknown;
      row_count?: number;
      file_size?: number;
      uploaded_at?: string;
    };
    if (!Array.isArray(row.columns) || !Array.isArray(row.rows)) return null;
    return {
      fileName: String(row.file_name ?? "saved-report.xlsx"),
      sheetName: String(row.sheet_name ?? "Sheet1"),
      columns: row.columns.map(String),
      rows: (row.rows as unknown[]).map((r) =>
        Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? "" : String(c))) : []
      ),
      rowCount: Number(row.row_count ?? (row.rows as unknown[]).length),
      fileSize: Number(row.file_size ?? 0),
      uploadedAt: String(row.uploaded_at ?? new Date().toISOString()),
    };
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
