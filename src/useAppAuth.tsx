import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadLoginPassword, saveLoginPassword } from "./loginAuth";

/**
 * Settings password state.
 *
 * Only Settings is protected. The unlocked state lives inside SettingsGate for
 * the duration of a single visit, so navigating into Settings always asks
 * again. This provider just holds the configured password (used by the gate to
 * compare, and by Settings → Access & Security to show/change it).
 */

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

type AppAuthValue = {
  /** False while the stored password is still being read. */
  ready: boolean;
  /** Current Settings password, as configured. */
  password: string;
  changePassword: (next: string) => Promise<{ ok: boolean; error?: string }>;
  saveStatus: SaveStatus;
  retrySave: () => void;
};

const AppAuthContext = createContext<AppAuthValue | null>(null);

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const mounted = useRef(true);
  const latestPassword = useRef("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await loadLoginPassword();
      if (cancelled || !mounted.current) return;
      latestPassword.current = current;
      setPassword(current);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: string) => {
    setSaveStatus("saving");
    try {
      await saveLoginPassword(next);
      if (mounted.current) setSaveStatus("saved");
    } catch {
      if (mounted.current) setSaveStatus("failed");
    }
  }, []);

  const changePassword = useCallback(
    async (next: string) => {
      const value = next.trim();
      if (!value) return { ok: false, error: "Password cannot be empty." };
      if (value.length < 6) return { ok: false, error: "Use at least 6 characters." };
      if (value === latestPassword.current) {
        return { ok: false, error: "That is already the current password." };
      }
      latestPassword.current = value;
      if (mounted.current) setPassword(value);
      void persist(value);
      return { ok: true };
    },
    [persist]
  );

  const retrySave = useCallback(() => {
    if (latestPassword.current) void persist(latestPassword.current);
  }, [persist]);

  const value = useMemo<AppAuthValue>(
    () => ({ ready, password, changePassword, saveStatus, retrySave }),
    [ready, password, changePassword, saveStatus, retrySave]
  );

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

export function useAppAuth(): AppAuthValue {
  const ctx = useContext(AppAuthContext);
  if (!ctx) throw new Error("useAppAuth must be used inside <AppAuthProvider>");
  return ctx;
}
