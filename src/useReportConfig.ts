import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { DEFAULT_GRN_COLUMNS } from "./reportConfig";

export type SyncStatus = "loading" | "saved" | "saving" | "failed";

const CONFIG_KEY = "grn_expected_columns";
const CACHE_KEY = "k12.grn.expectedColumns";

function readCache(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

function writeCache(value: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable — memory state still works
  }
}

/**
 * Report config state synced to Supabase (public.report_config).
 * - Loads from the DB on mount (falls back to cache/defaults when offline).
 * - Saves immediately on every change; tracks saving/saved/failed so the UI
 *   can show real persistence status with a retry path.
 * - Guards against a slow initial load overwriting local unsaved edits.
 */
export function useReportConfig() {
  const [columns, setColumnsState] = useState<string[]>(() => readCache() ?? DEFAULT_GRN_COLUMNS);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const inFlight = useRef(0);
  const mounted = useRef(true);
  const latestValue = useRef<string[]>(columns);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const persist = useCallback(async (value: string[]) => {
    if (!isSupabaseConfigured) return;
    inFlight.current += 1;
    setStatus("saving");
    try {
      const { error } = await supabase
        .from("report_config")
        .upsert(
          { config_key: CONFIG_KEY, value, updated_at: new Date().toISOString() },
          { onConflict: "config_key" }
        );
      if (error) throw error;
    } catch {
      if (mounted.current) setStatus("failed");
      return;
    } finally {
      inFlight.current -= 1;
    }
    if (mounted.current && inFlight.current === 0) setStatus("saved");
  }, []);

  // Initial load: prefer the DB, but never clobber newer local edits
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStatus("failed");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("report_config")
        .select("value")
        .eq("config_key", CONFIG_KEY)
        .maybeSingle();
      if (cancelled || !mounted.current) return;
      if (error) {
        setStatus("failed");
        return;
      }
      const remote = data?.value as unknown;
      if (Array.isArray(remote) && remote.every((v) => typeof v === "string") && remote.length > 0) {
        setColumnsState(remote);
        writeCache(remote);
      }
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setColumns = useCallback(
    (next: string[]) => {
      latestValue.current = next;
      setColumnsState(next);
      writeCache(next);
      void persist(next);
    },
    [persist]
  );

  const retrySave = useCallback(() => {
    void persist(latestValue.current);
  }, [persist]);

  return { columns, setColumns, status, retrySave };
}
