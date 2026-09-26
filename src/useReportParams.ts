import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

export type ReportParams = {
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  taproot: boolean;
};

const CONFIG_KEY = "grn_report_params";
const CACHE_KEY = "k12.grn.reportParams";

export function defaultParams(): ReportParams {
  const end = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  return {
    startDate: "2026-01-01",
    endDate: end.toISOString().slice(0, 10),
    taproot: false,
  };
}

function readCache(): ReportParams | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ReportParams;
    return p && typeof p.startDate === "string" && typeof p.endDate === "string"
      ? { ...p, taproot: Boolean(p.taproot) }
      : null;
  } catch {
    return null;
  }
}

function writeCache(p: ReportParams) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export function useReportParams() {
  const [params, setParamsState] = useState<ReportParams>(() => readCache() ?? defaultParams());
  const [status, setStatus] = useState<"loading" | "saved" | "saving" | "failed">("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
      const remote = data?.value as Partial<ReportParams> | null;
      if (remote && typeof remote.startDate === "string" && typeof remote.endDate === "string") {
        const merged: ReportParams = {
          startDate: remote.startDate,
          endDate: remote.endDate,
          taproot: Boolean(remote.taproot),
        };
        setParamsState(merged);
        writeCache(merged);
      }
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: ReportParams) => {
    setParamsState(next);
    writeCache(next);
    if (!isSupabaseConfigured) return false;
    setStatus("saving");
    try {
      const { error } = await supabase.from("report_config").upsert(
        {
          config_key: CONFIG_KEY,
          value: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "config_key" }
      );
      if (error) throw error;
    } catch {
      if (mounted.current) setStatus("failed");
      return false;
    }
    if (mounted.current) setStatus("saved");
    return true;
  }, []);

  return { params, save, status };
}
