import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import type { HistoricFetchLog } from "./types";

/**
 * Global, app-level Historic Report fetch state.
 *
 * Lives ABOVE page components (mounted once in App), so:
 *  - a Fetch Now keeps running while the user navigates to other pages,
 *  - the loading overlay can be rendered globally,
 *  - the data cache survives page switches (no re-paging on every visit).
 */
export type HistoricGlobalState = {
  logs: Record<string, HistoricFetchLog>;
  logsLoading: boolean;
  fetching: boolean;
  fetchError: string | null;
  fetchPhase: "idle" | "fetching" | "loading-data";
  fetchProgress: string;
  rows: import("./types").PaymentReportRow[];
  dataLoading: boolean;
  loadError: string | null;
  fetchNow: (report: "payment" | "all") => Promise<unknown>;
  reloadLogs: () => Promise<void>;
  /** True once the full snapshot has been paged into memory. */
  hasData: boolean;
};

const Ctx = createContext<HistoricGlobalState | null>(null);

export function HistoricProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<Record<string, HistoricFetchLog>>({});
  const [logsLoading, setLogsLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchPhase, setFetchPhase] = useState<"idle" | "fetching" | "loading-data">("idle");
  const [fetchProgress, setFetchProgress] = useState("");
  const [rows, setRows] = useState<import("./types").PaymentReportRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mounted = useRef(true);
  const loadedOnce = useRef(false);
  const reloadLogsRef = useRef<() => Promise<void>>(async () => {});

  const loadLogs = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLogsLoading(false);
      return;
    }
    const { data, error } = await supabase.from("historic_fetch_log").select("*");
    if (!mounted.current) return;
    if (error) {
      setLogs({});
    } else {
      const map: Record<string, HistoricFetchLog> = {};
      for (const row of (data ?? []) as HistoricFetchLog[]) map[row.report_key] = row;
      setLogs(map);
    }
    setLogsLoading(false);
  }, []);

  reloadLogsRef.current = loadLogs;

  useEffect(() => {
    mounted.current = true;
    void loadLogs();
    return () => {
      mounted.current = false;
    };
  }, [loadLogs]);

  /** Page in the whole snapshot (runs in the provider, survives page switches). */
  const loadAllRows = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setDataLoading(true);
    setFetchPhase("loading-data");
    setFetchProgress("Loading payment data…");
    const all: import("./types").PaymentReportRow[] = [];
    const PAGE = 1000;
    for (let offset = 0; offset < 200000; offset += PAGE) {
      const { data, error } = await supabase
        .from("payment_report_rows")
        .select("*")
        .order("first_paid_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (!mounted.current) return; // app unmounted — abandon silently
      if (error) {
        const msg =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        setLoadError(msg);
        break;
      }
      const page = (data ?? []) as import("./types").PaymentReportRow[];
      all.push(...page);
      setFetchProgress(
        `Loaded ${all.length.toLocaleString("en-IN")} of ~95,510 students…`
      );
      if (page.length < PAGE) break;
    }
    if (!mounted.current) return;
    setRows(all);
    setDataLoading(false);
    setLoadError(null);
    setFetchPhase("idle");
    setFetchProgress("");
    loadedOnce.current = true;
  }, []);

  // Load data once on app start (background — user can navigate freely)
  useEffect(() => {
    void loadAllRows();
  }, [loadAllRows]);

  const fetchNow = useCallback(async (report: "payment" | "all") => {
    setFetching(true);
    setFetchError(null);
    setFetchPhase("fetching");
    setFetchProgress(
      "Fetching from Eduvate — downloading and processing ~190k rows (30–60s)…"
    );
    try {
      const res = await fetch(`/api/fetch-historic?report=${report}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || `Fetch failed (${res.status})`);
      }
      await reloadLogsRef.current();
      // Refetch the dataset in the background
      void loadAllRows();
      return body;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFetchError(msg);
      setFetchPhase("idle");
      setFetchProgress("");
      throw e;
    } finally {
      setFetching(false);
    }
  }, [loadAllRows]);

  const value: HistoricGlobalState = {
    logs,
    logsLoading,
    fetching,
    fetchError,
    fetchPhase,
    fetchProgress,
    rows,
    dataLoading,
    loadError,
    fetchNow,
    reloadLogs: loadLogs,
    hasData: loadedOnce.current,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHistoricGlobal(): HistoricGlobalState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHistoricGlobal must be used inside HistoricProvider");
  return v;
}
