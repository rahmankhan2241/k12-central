import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

export type IcseRule = {
  branch: string; // Branch (Eduvate) name, matched case-insensitively
  grade: string; // Grade as it appears in the report, matched case-insensitively
};

const CONFIG_KEY = "historic_icse_config";
const CACHE_KEY = "k12.historic.icseConfig";

function readCache(): IcseRule[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IcseRule[]) : [];
  } catch {
    return [];
  }
}

function writeCache(rows: IcseRule[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    // ignore — memory state still works
  }
}

export type MappingSyncStatus = "loading" | "saved" | "saving" | "failed";

/**
 * ICSE configuration (Settings → Historic Report Related): a list of
 * Branch Name + Grade pairs. On the Historic Report page, a row whose branch
 * AND grade both match a pair (case-insensitive) is labeled "ICSE",
 * everything else "OIS". Stored in report_config under historic_icse_config.
 */
export function useIcseConfig() {
  const [rows, setRowsState] = useState<IcseRule[]>(() => readCache());
  const [status, setStatus] = useState<MappingSyncStatus>("loading");
  const mounted = useRef(true);
  const latest = useRef<IcseRule[]>(rows);

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
        const clean = (remote as IcseRule[]).filter(
          (r) => r && typeof r === "object" && typeof r.branch === "string" && typeof r.grade === "string"
        );
        latest.current = clean;
        setRowsState(clean);
        writeCache(clean);
      }
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: IcseRule[]) => {
    if (!isSupabaseConfigured) return;
    setStatus("saving");
    try {
      const { error } = await supabase.from("report_config").upsert(
        { config_key: CONFIG_KEY, value: next, updated_at: new Date().toISOString() },
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
    (next: IcseRule[]) => {
      latest.current = next;
      setRowsState(next);
      writeCache(next);
      void persist(next);
    },
    [persist]
  );

  const retrySave = useCallback(() => {
    void persist(latest.current);
  }, [persist]);

  /** ICSE lookup for one row: branch AND grade must both match (case-insensitive). */
  const isIcse = useCallback((branch: string, grade: string) => {
    const b = branch.trim().toLowerCase();
    const g = grade.trim().toLowerCase();
    if (!b || !g) return false;
    return latest.current.some((r) => r.branch.trim().toLowerCase() === b && r.grade.trim().toLowerCase() === g);
  }, []);

  return { rows, setRows, status, retrySave, isIcse };
}
