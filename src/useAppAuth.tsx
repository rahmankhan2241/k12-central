import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  clearSessionToken,
  hashLoginPassword,
  loadLoginPassword,
  readSessionToken,
  saveLoginPassword,
  writeSessionToken,
} from "./loginAuth";

/**
 * App-wide login gate state.
 *
 * The whole console is behind one shared password (Settings → Access & Security
 * lets you change it). A successful sign-in is remembered in localStorage via a
 * hash of the password, so a refresh or a new tab does not ask again — and
 * changing the password signs other devices out on their next load.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

type AppAuthValue = {
  /** False while the stored password is still being read. */
  ready: boolean;
  authed: boolean;
  /** Current access password, as configured (used by the Settings card). */
  password: string;
  submitPassword: (entered: string) => Promise<boolean>;
  lockNow: () => void;
  changePassword: (next: string) => Promise<{ ok: boolean; error?: string }>;
  saveStatus: SaveStatus;
  retrySave: () => void;
};

const AppAuthContext = createContext<AppAuthValue | null>(null);

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
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

  // Load the configured password, then restore an existing session if the
  // remembered token still matches it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await loadLoginPassword();
      const token = readSessionToken();
      const expected = await hashLoginPassword(current);
      if (cancelled || !mounted.current) return;
      latestPassword.current = current;
      setPassword(current);
      setAuthed(token !== null && token === expected);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitPassword = useCallback(async (entered: string) => {
    const expected = await hashLoginPassword(latestPassword.current);
    const given = await hashLoginPassword(entered);
    if (given !== expected) return false;
    writeSessionToken(expected);
    if (!mounted.current) return true;
    setAuthed(true);
    return true;
  }, []);

  const lockNow = useCallback(() => {
    clearSessionToken();
    setAuthed(false);
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
      const token = await hashLoginPassword(value);
      latestPassword.current = value;
      if (mounted.current) {
        setPassword(value);
        setAuthed(true); // this device stays signed in with the new password
      }
      writeSessionToken(token);
      void persist(value);
      return { ok: true };
    },
    [persist]
  );

  const retrySave = useCallback(() => {
    if (latestPassword.current) void persist(latestPassword.current);
  }, [persist]);

  const value = useMemo<AppAuthValue>(
    () => ({
      ready,
      authed,
      password,
      submitPassword,
      lockNow,
      changePassword,
      saveStatus,
      retrySave,
    }),
    [ready, authed, password, submitPassword, lockNow, changePassword, saveStatus, retrySave]
  );

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

export function useAppAuth(): AppAuthValue {
  const ctx = useContext(AppAuthContext);
  if (!ctx) throw new Error("useAppAuth must be used inside <AppAuthProvider>");
  return ctx;
}
