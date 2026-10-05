import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Login password for the whole console.
 *
 * The password lives in Supabase (report_config → app_login_password) so it can
 * be changed from Settings without a redeploy. DEFAULT_PASSWORD is only the
 * starting value used the very first time (or when the DB can't be reached and
 * nothing is cached yet).
 *
 * Sessions: after a successful sign-in we store a hash of the password in
 * localStorage. Because the hash is derived from the password itself, changing
 * the password automatically signs every other device out on its next load.
 */

export const DEFAULT_PASSWORD = "R@hman2241";

const CONFIG_KEY = "app_login_password";
const PASSWORD_CACHE_KEY = "k12.login.password";
const SESSION_KEY = "k12.login.token";

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

/**
 * Deterministic hash used as the stored session token. Not a security boundary
 * on its own — the gate is a soft net around an internal tool.
 */
export async function hashLoginPassword(value: string): Promise<string> {
  const text = `k12-central:v1:${value}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Plain http (LAN IP, not localhost) has no WebCrypto — small fallback hash so
  // the gate still works there.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
  }
  return `fallback:${h1.toString(16)}${h2.toString(16)}`;
}

export function readSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeSessionToken(token: string) {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    // storage unavailable — the user will be asked again on the next load
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
