import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

export type HistoricReportKey = "tpnd_installment" | "store_kit_wise";

export const TPND_ALL_COLUMNS = [
  "Branch Name",
  "Paid Date",
  "Grade",
  "Enrollment Code",
  "Permanent Status",
] as const;

export const STORE_ALL_COLUMNS = [
  "Branch",
  "Paid Date",
  "Enrollment Code",
  "Grade",
  "Section",
  "Kit Name",
  "Quantity",
  "Amount",
  "Total",
  "Receipt No",
] as const;

const KEY_BY_REPORT: Record<HistoricReportKey, string> = {
  tpnd_installment: "historic_tpnd_columns",
  store_kit_wise: "historic_store_columns",
};

const DEFAULTS: Record<HistoricReportKey, string[]> = {
  tpnd_installment: [...TPND_ALL_COLUMNS],
  store_kit_wise: [...STORE_ALL_COLUMNS],
};

/**
 * Column visibility config for each Historic Report, persisted to
 * report_config (config_key = historic_tpnd_columns / historic_store_columns).
 * Whatever columns are selected here are the ones shown and filterable on the
 * Historic Report page.
 */
export function useHistoricColumns(report: HistoricReportKey) {
  const [columns, setColumnsState] = useState<string[]>(() => DEFAULTS[report]);
  const [status, setStatus] = useState<"loading" | "saved" | "saving" | "failed">("loading");
  const latest = useRef<string[]>(columns);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load from DB whenever the report switches
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStatus("failed");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("report_config")
        .select("value")
        .eq("config_key", KEY_BY_REPORT[report])
        .maybeSingle();
      if (cancelled || !mounted.current) return;
      const remote = data?.value as unknown;
      if (Array.isArray(remote) && remote.every((v) => typeof v === "string") && remote.length > 0) {
        setColumnsState(remote);
        latest.current = remote;
      } else {
        setColumnsState(DEFAULTS[report]);
        latest.current = DEFAULTS[report];
      }
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, [report]);

  const persist = useCallback(
    async (value: string[]) => {
      if (!isSupabaseConfigured) return;
      setStatus("saving");
      try {
        const { error } = await supabase.from("report_config").upsert(
          { config_key: KEY_BY_REPORT[report], value, updated_at: new Date().toISOString() },
          { onConflict: "config_key" }
        );
        if (error) throw error;
        if (mounted.current) setStatus("saved");
      } catch {
        if (mounted.current) setStatus("failed");
      }
    },
    [report]
  );

  const toggleColumn = useCallback(
    (col: string) => {
      const current = latest.current;
      const next = current.includes(col)
        ? current.filter((c) => c !== col)
        : [...current, col];
      latest.current = next;
      setColumnsState(next);
      void persist(next);
    },
    [persist]
  );

  const resetColumns = useCallback(() => {
    latest.current = DEFAULTS[report];
    setColumnsState(DEFAULTS[report]);
    void persist(DEFAULTS[report]);
  }, [persist, report]);

  return { columns, toggleColumn, resetColumns, status, allColumns: DEFAULTS[report] };
}
