import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Access password for the Settings page.
 *
 * The password lives in Supabase (report_config → app_login_password) so it can
 * be changed from Settings without a redeploy. DEFAULT_PASSWORD is only the
 * starting value used the very first time (or when the DB can't be reached and
 * nothing is cached yet).
 *
 * There is no session: the Settings page asks for the password every time it is
 * opened, so nothing about a successful unlock is persisted here.
 */

export const DEFAULT_PASSWORD = "R@hman2241";

const CONFIG_KEY = "app_login_password";
const PASSWORD_CACHE_KEY = "k12.login.password";

function readPasswordCache(): string | null {
  try {
    const value = localStorage.getItem(PASSWORD_CACHE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writePasswordCache(value: string) {
  try {
    localStorage.setItem(PASSWORD_CACHE_KEY, value);
  } catch {
    // storage unavailable — the in-memory value still works for this session
  }
}

/** Reads the current password: DB first, then the local cache, then the default. */
export async function loadLoginPassword(): Promise<string> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("report_config")
        .select("value")
        .eq("config_key", CONFIG_KEY)
        .maybeSingle();
      if (!error) {
        const remote = data?.value as unknown;
        if (typeof remote === "string" && remote.length > 0) {
          writePasswordCache(remote);
          return remote;
        }
      }
    } catch {
      // fall through to the cache/default below
    }
  }
  return readPasswordCache() ?? DEFAULT_PASSWORD;
}

/** Persists a new password to the DB (and locally, so offline loads accept it). */
export async function saveLoginPassword(next: string): Promise<void> {
  writePasswordCache(next);
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured");
  const { error } = await supabase
    .from("report_config")
    .upsert(
      { config_key: CONFIG_KEY, value: next, updated_at: new Date().toISOString() },
      { onConflict: "config_key" }
    );
  if (error) throw error;
}
