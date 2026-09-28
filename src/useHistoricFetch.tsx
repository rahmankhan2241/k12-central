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
 *  - the per-year data cache survives page switches (no re-paging on visits).
 */
export type HistoricGlobalState = {
  logs: Record<string, HistoricFetchLog>;
  logsLoading: boolean;
  fetching: boolean;
  fetchError: string | null;
  fetchPhase: "idle" | "fetching" | "loading-data";
  fetchProgress: string;
  /** Rows of the currently selected academic year. */
  rows: import("./types").PaymentReportRow[];
  dataLoading: boolean;
  loadError: string | null;
  selectedYear: string;
  setSelectedYear: (year: string) => void;
  /** True when the DB is missing the session_year column (migration pending). */
  needsMigration: boolean;
  /** Runs the WHOLE pipeline for the given year: Eduvate → filter/dedupe → Supabase → reload UI. */
  fetchNow: (report: "payment" | "all", year?: string) => Promise<unknown>;
  reloadLogs: () => Promise<void>;
  /** True once the selected year's snapshot has been paged into memory. */
  hasData: boolean;
};

const Ctx = createContext<HistoricGlobalState | null>(null);

const PAGE = 1000; // PostgREST hard cap per request
const PARALLEL = 8; // concurrent page requests
const DEFAULT_YEAR = "2026-27";

/**
 * In-flight guard per year, shared by every HistoricProvider instance.
 * React StrictMode mounts effects twice, and a Fetch Now triggers another
 * load while one may still be running — without this, concurrent loads
 * double the requests and can overwrite each other's results.
 */
const inflightLoads = new Map<string, Promise<void>>();

export function HistoricProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<Record<string, HistoricFetchLog>>({});
  const [logsLoading, setLogsLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchPhase, setFetchPhase] = useState<"idle" | "fetching" | "loading-data">("idle");
  const [fetchProgress, setFetchProgress] = useState("");
  const [selectedYear, setSelectedYearState] = useState(DEFAULT_YEAR);
  const [rowsByYear, setRowsByYear] = useState<Record<string, import("./types").PaymentReportRow[]>>(
    {}
  );
  const [loadingYears, setLoadingYears] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const mounted = useRef(true);
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
   * Core snapshot load for ONE academic year. Pages run in waves of PARALLEL
   * requests (instead of ~96 sequential round-trips) — roughly 8x faster.
   */
  const runLoad = useCallback(async (year: string) => {
    if (!isSupabaseConfigured) return;
    setLoadingYears((m) => ({ ...m, [year]: true }));
    setFetchPhase("loading-data");
    setFetchProgress(`Loading ${year} payment data…`);

    /** Fresh builder per request — reusing one builder would share URL params across parallel calls. */
    const pageQuery = (from: number, to: number, exactCount = false, withYearFilter = true) => {
      let q = supabase
        .from("payment_report_rows")
        .select("*", { count: exactCount ? "exact" : undefined });
      if (withYearFilter) q = q.eq("session_year", year);
      return q
        .order("first_paid_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    };

    const errText = (e: unknown) =>
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);

    const finish = () => {
      if (!mounted.current) return;
      setLoadingYears((m) => ({ ...m, [year]: false }));
      setFetchPhase("idle");
      setFetchProgress("");
    };

    // 1) First page carries the exact total. If the session_year column is
    //    missing (migration not run yet) we can still load the legacy 26-27
    //    table contents — but ONLY for 26-27; other years must not show
    //    another year's data.
    let first = await pageQuery(0, PAGE - 1, true);
    let yearFilter = true;
    if (first.error && String(errText(first.error)).includes("session_year")) {
      setNeedsMigration(true);
      if (year !== DEFAULT_YEAR) {
        setLoadError(
          "The database is missing the session_year column — run scripts/migration-session-year.sql in Supabase first."
        );
        finish();
        return;
      }
      yearFilter = false;
      first = await pageQuery(0, PAGE - 1, true, false);
    }
    if (!mounted.current) return;
    if (first.error) {
      setLoadError(errText(first.error));
      finish();
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
            Promise.resolve(pageQuery(p * PAGE, (p + 1) * PAGE - 1, false, yearFilter)).then(
              (r) => {
                if (r.error) throw r.error;
                return (r.data ?? []) as import("./types").PaymentReportRow[];
              }
            )
          );
        }
        const results = await Promise.all(wave); // any failure rejects here
        if (!mounted.current) return;
        all.push(...results.flat());
        setFetchProgress(
          `Loaded ${all.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} ${year} students…`
        );
      }
      if (!mounted.current) return;
      setRowsByYear((m) => ({ ...m, [year]: all }));
      setLoadError(null);
    } catch (e) {
      if (!mounted.current) return;
      setLoadError(errText(e));
    } finally {
      finish();
    }
  }, []);

  /**
   * Public per-year loader with a singleton guard. While a year's load is
   * running, extra callers join it (StrictMode double-invokes effects) —
   * except Fetch Now, which waits for the current pass and then runs a
   * fresh one, because the rows it just wrote may have landed mid-flight
   * of the earlier load.
   */
  const loadAllRows = useCallback(async (year: string, opts?: { fresh?: boolean }) => {
    const inflight = inflightLoads.get(year);
    if (inflight) {
      await inflight.catch(() => {});
      if (!opts?.fresh) return; // joined an equivalent, already-current load
    }
    const p = runLoad(year).finally(() => {
      if (inflightLoads.get(year) === p) inflightLoads.delete(year);
    });
    inflightLoads.set(year, p);
    await p.catch(() => {});
  }, [runLoad]);

  // Load the current year's data once on app start (background — user can navigate freely)
  useEffect(() => {
    void loadAllRows(DEFAULT_YEAR);
  }, [loadAllRows]);

  const setSelectedYear = useCallback(
    (year: string) => {
      setSelectedYearState(year);
      // Load on demand; cached years switch instantly.
      void loadAllRows(year);
    },
    [loadAllRows]
  );

  /**
   * Runs the whole pipeline for one academic year and AWAITS every step:
   *  1. Serverless: login to Eduvate → download that session's CSV →
   *     filter/dedupe → write the year-tagged snapshot (old rows removed).
   *  2. Reload fetch logs (per-year freshness banner).
   *  3. Reload that year's rows so the UI shows the fresh data.
   * Only then does the button stop spinning.
   */
  const fetchNow = useCallback(
    async (report: "payment" | "all", year?: string) => {
      const y = year ?? selectedYear;
      setFetching(true);
      setFetchError(null);
      setFetchPhase("fetching");
      setFetchProgress(
        `Running the full ${y} pipeline — downloading from Eduvate, filtering and writing to Supabase (30–60s)…`
      );
      try {
        const res = await fetch(`/api/fetch-historic?report=${report}&year=${encodeURIComponent(y)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          throw new Error(body.error || `Fetch failed (${res.status})`);
        }
        if (mounted.current) {
          setFetchProgress(`${y} data written to Supabase — refreshing the report…`);
        }
        await reloadLogsRef.current();
        await loadAllRows(y, { fresh: true }); // UI shows fresh rows before the button finishes
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
    [loadAllRows, selectedYear]
  );

  const rows = rowsByYear[selectedYear] ?? [];
  const dataLoading = Boolean(loadingYears[selectedYear]);

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
    selectedYear,
    setSelectedYear,
    needsMigration,
    fetchNow,
    reloadLogs: loadLogs,
    hasData: rowsByYear[selectedYear] != null,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHistoricGlobal(): HistoricGlobalState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHistoricGlobal must be used inside HistoricProvider");
  return v;
}
