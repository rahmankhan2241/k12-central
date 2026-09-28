import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import type { HistoricFetchLog } from "./types";

/**
 * Fetch-log + fetch-now state for the Historic Report page.
 * - `logs` gives last_fetched_at per report_key so the UI can show freshness.
 * - `fetchNow()` calls the /api/fetch-historic serverless function.
 */
export function useHistoricFetch() {
  const [logs, setLogs] = useState<Record<string, HistoricFetchLog>>({});
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const mounted = useRef(true);

  const loadLogs = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("historic_fetch_log")
      .select("*");
    if (!mounted.current) return;
    if (error) {
      setLogs({});
    } else {
      const map: Record<string, HistoricFetchLog> = {};
      for (const row of (data ?? []) as HistoricFetchLog[]) map[row.report_key] = row;
      setLogs(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadLogs();
    return () => {
      mounted.current = false;
    };
  }, [loadLogs]);

  const fetchNow = useCallback(
    async (report: "tpnd" | "store" | "all") => {
      setFetching(true);
      setFetchError(null);
      try {
        const res = await fetch(`/api/fetch-historic?report=${report}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          throw new Error(body.error || `Fetch failed (${res.status})`);
        }
        await loadLogs();
        return body;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setFetchError(msg);
        throw e;
      } finally {
        if (mounted.current) setFetching(false);
      }
    },
    [loadLogs]
  );

  return { logs, loading, fetching, fetchError, fetchNow, reloadLogs: loadLogs };
}
