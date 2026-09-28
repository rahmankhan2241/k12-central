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
  /** Runs the WHOLE pipeline: Eduvate → filter/dedupe → write Supabase → reload UI. */
  fetchNow: (report: "payment" | "all") => Promise<unknown>;
  reloadLogs: () => Promise<void>;
  /** True once the full snapshot has been paged into memory. */
  hasData: boolean;
};

const Ctx = createContext<HistoricGlobalState | null>(null);

const PAGE = 1000; // PostgREST hard cap per request
const PARALLEL = 8; // concurrent page requests

/**
 * In-flight guard shared by every HistoricProvider instance.
 * React StrictMode mounts effects twice, and a Fetch Now triggers another
 * load while one may still be running — without this, concurrent loads
 * double the requests and can overwrite each other's results.
 */
let inflightLoad: Promise<void> | null = null;

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

  /**
   * Core snapshot load. Pages run in waves of PARALLEL requests
   * (instead of ~96 sequential round-trips) — roughly 8x faster, same order.
   */
  const runLoad = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setDataLoading(true);
    setFetchPhase("loading-data");
    setFetchProgress("Loading payment data…");

    /** Fresh builder per request — reusing one builder would share URL params across parallel calls. */
    const pageQuery = (from: number, to: number, exactCount = false) =>
      supabase
        .from("payment_report_rows")
        .select("*", { count: exactCount ? "exact" : undefined })
        .order("first_paid_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

    const errText = (e: unknown) =>
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);

    // 1) First page also carries the exact total so the UI can show progress.
    const first = await pageQuery(0, PAGE - 1, true);
    if (!mounted.current) return;
    if (first.error) {
      setLoadError(errText(first.error));
      setDataLoading(false);
      setFetchPhase("idle");
      setFetchProgress("");
      return;
    }
    const total = first.count ?? (first.data as import("./types").PaymentReportRow[]).length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));

    // 2) Remaining pages in parallel waves of PARALLEL; wave results arrive in order.
    const all: import("./types").PaymentReportRow[] = [
      ...((first.data ?? []) as import("./types").PaymentReportRow[]),
    ];
    try {
      for (let start = 1; start < totalPages; start += PARALLEL) {
        const wave: Promise<import("./types").PaymentReportRow[]>[] = [];
        for (let p = start; p < Math.min(start + PARALLEL, totalPages); p++) {
          // Promise.resolve() turns the supabase thenable into a real Promise.
          wave.push(
            Promise.resolve(pageQuery(p * PAGE, (p + 1) * PAGE - 1)).then((r) => {
              if (r.error) throw r.error;
              return (r.data ?? []) as import("./types").PaymentReportRow[];
            })
          );
        }
        const results = await Promise.all(wave); // any failure rejects here
        if (!mounted.current) return;
        all.push(...results.flat());
        setFetchProgress(
          `Loaded ${all.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} students…`
        );
      }
      if (!mounted.current) return;
      setRows(all);
      setLoadError(null);
      loadedOnce.current = true;
    } catch (e) {
      if (!mounted.current) return;
      setLoadError(errText(e));
    } finally {
      if (mounted.current) {
        setDataLoading(false);
        setFetchPhase("idle");
        setFetchProgress("");
      }
    }
  }, []);

  /**
   * Public loader with a singleton guard. While a load is running, extra
   * callers join it (StrictMode double-invokes the app-start effect) —
   * except Fetch Now, which waits for the current pass and then runs a
   * fresh one, because the rows it just wrote may have landed mid-flight
   * of the earlier load.
   */
  const loadAllRows = useCallback(
    async (opts?: { fresh?: boolean }) => {
      if (inflightLoad) {
        await inflightLoad.catch(() => {});
        if (!opts?.fresh) return; // joined an equivalent, already-current load
      }
      const p = runLoad().finally(() => {
        if (inflightLoad === p) inflightLoad = null;
      });
      inflightLoad = p;
      await p.catch(() => {});
    },
    [runLoad]
  );

  // Load data once on app start (background — user can navigate freely)
  useEffect(() => {
    void loadAllRows();
  }, [loadAllRows]);

  /**
   * Runs the whole pipeline end-to-end and AWAITS every step:
   *  1. Serverless: login to Eduvate → download CSV → filter/dedupe →
   *     write the new snapshot into Supabase (old rows removed).
   *  2. Reload fetch logs (freshness banner).
   *  3. Reload all rows from Supabase so the UI shows the fresh data.
   * Only then does the button stop spinning.
   */
  const fetchNow = useCallback(
    async (report: "payment" | "all") => {
      setFetching(true);
      setFetchError(null);
      setFetchPhase("fetching");
      setFetchProgress(
        "Running the full pipeline — downloading from Eduvate, filtering and writing to Supabase (30–60s)…"
      );
      try {
        const res = await fetch(`/api/fetch-historic?report=${report}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          throw new Error(body.error || `Fetch failed (${res.status})`);
        }
        if (mounted.current) {
          setFetchProgress("Eduvate data written to Supabase — refreshing the report…");
        }
        await reloadLogsRef.current();
        await loadAllRows({ fresh: true }); // UI shows fresh rows before the button finishes
        return body;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mounted.current) {
          setFetchError(msg);
          setFetchPhase("idle");
          setFetchProgress("");
        }
        throw e;
      } finally {
        setFetching(false);
      }
    },
    [loadAllRows]
  );

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
