import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import type { BranchZbhMapping } from "./types";

const CONFIG_KEY = "grn_branch_zbh_mapping";
const CACHE_KEY = "k12.grn.branchZbhMapping";

function readCache(): BranchZbhMapping[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BranchZbhMapping[]) : [];
  } catch {
    return [];
  }
}

function writeCache(rows: BranchZbhMapping[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

export type MappingSyncStatus = "loading" | "saved" | "saving" | "failed";

export function useBranchZbhMapping() {
  const [rows, setRowsState] = useState<BranchZbhMapping[]>(() => readCache());
  const [status, setStatus] = useState<MappingSyncStatus>("loading");
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
      const remote = data?.value as unknown;
      if (Array.isArray(remote)) {
        const clean = (remote as BranchZbhMapping[]).filter(
          (r) => r && typeof r === "object"
        );
        setRowsState(clean);
        writeCache(clean);
      }
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: BranchZbhMapping[]) => {
    if (!isSupabaseConfigured) return;
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
      return;
    }
    if (mounted.current) setStatus("saved");
  }, []);

  const setRows = useCallback(
    (next: BranchZbhMapping[]) => {
      setRowsState(next);
      writeCache(next);
      void persist(next);
    },
    [persist]
  );

  const retrySave = useCallback(() => {
    void persist(rows);
  }, [persist, rows]);

  return { rows, setRows, status, retrySave };
}
