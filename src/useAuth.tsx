import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  ALL_MODULE_IDS,
  cacheUsers,
  deleteUser,
  isAdminUsername,
  loadUsers,
  normalizeUsername,
  readStoredSession,
  readUsersCache,
  saveUser,
  writeStoredSession,
} from "./users";
import type { AppUser, AuthSession, ModuleId } from "./users";

/**
 * Sign-in and account management.
 *
 * The admin (built-in credentials) always has full access. Regular accounts
 * are created in Settings → Access & Security and open only their assigned
 * modules. The session survives refreshes until Sign out.
 */

export type UsersStatus = "loading" | "saved" | "saving" | "failed";

type PendingOp = { kind: "upsert"; user: AppUser } | { kind: "delete"; username: string };

type AuthValue = {
  /** False until the stored accounts have been read. */
  ready: boolean;
  session: AuthSession | null;
  users: AppUser[];
  usersStatus: UsersStatus;
  login: (username: string, password: string) => { ok: boolean; error?: string };
  logout: () => void;
  addUser: (username: string, password: string, modules: ModuleId[]) => { ok: boolean; error?: string };
  updateUser: (username: string, patch: { password?: string; modules?: ModuleId[] }) => { ok: boolean; error?: string };
  removeUser: (username: string) => void;
  retrySync: () => void;
  reloadUsers: () => void;
  canAccess: (pageId: string) => boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

function sameModules(a: ModuleId[], b: ModuleId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState<AppUser[]>(() => readUsersCache());
  const [usersStatus, setUsersStatus] = useState<UsersStatus>("loading");
  const [session, setSessionState] = useState<AuthSession | null>(() => readStoredSession());
  const pendingRef = useRef<PendingOp | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applySession = useCallback((next: AuthSession | null) => {
    writeStoredSession(next);
    setSessionState(next);
  }, []);

  const reloadUsers = useCallback(async () => {
    setUsersStatus("loading");
    const { users: loaded, failed } = await loadUsers();
    if (!mounted.current) return;
    setUsers(loaded);
    setUsersStatus(failed ? "failed" : "saved");
    setReady(true);
  }, []);

  useEffect(() => {
    void reloadUsers();
  }, [reloadUsers]);

  // A session for a deleted account is dropped as soon as the list is known;
  // module changes made by the admin apply the next time that account signs in.
  useEffect(() => {
    if (!ready || !session || session.isAdmin) return;
    const found = users.find((u) => normalizeUsername(u.username) === normalizeUsername(session.username));
    if (!found) {
      applySession(null);
      return;
    }
    if (!sameModules(found.modules, session.modules)) {
      applySession({ username: found.username, isAdmin: false, modules: found.modules });
    }
  }, [ready, users, session, applySession]);

  const runOp = useCallback(async (op: PendingOp) => {
    setUsersStatus("saving");
    try {
      if (op.kind === "upsert") await saveUser(op.user);
      else await deleteUser(op.username);
      if (!mounted.current) return;
      pendingRef.current = null;
      setUsersStatus("saved");
    } catch {
      if (!mounted.current) return;
      pendingRef.current = op;
      setUsersStatus("failed");
    }
  }, []);

  const commitUsers = useCallback((next: AppUser[]) => {
    cacheUsers(next);
    setUsers(next);
  }, []);

  const login = useCallback(
    (username: string, password: string): { ok: boolean; error?: string } => {
      const name = username.trim();
      if (!name || !password) return { ok: false, error: "Enter your username and password." };
      if (isAdminUsername(name)) {
        if (password !== ADMIN_PASSWORD) return { ok: false, error: "Wrong username or password." };
        applySession({ username: ADMIN_USERNAME, isAdmin: true, modules: ALL_MODULE_IDS });
        return { ok: true };
      }
      const user = users.find((u) => normalizeUsername(u.username) === normalizeUsername(name));
      if (!user || user.password !== password) return { ok: false, error: "Wrong username or password." };
      applySession({ username: user.username, isAdmin: false, modules: user.modules });
      return { ok: true };
    },
    [users, applySession]
  );

  const logout = useCallback(() => {
    applySession(null);
  }, [applySession]);

  const addUser = useCallback(
    (username: string, password: string, modules: ModuleId[]): { ok: boolean; error?: string } => {
      const name = username.trim();
      if (name.length < 3) return { ok: false, error: "Username must be at least 3 characters." };
      if (isAdminUsername(name)) return { ok: false, error: "That username is reserved for the admin." };
      if (users.some((u) => normalizeUsername(u.username) === normalizeUsername(name))) {
        return { ok: false, error: "That username already exists." };
      }
      if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
      if (modules.length === 0) return { ok: false, error: "Pick at least one module for this user." };
      const user: AppUser = { username: name, password, modules: [...modules] };
      commitUsers([...users, user]);
      void runOp({ kind: "upsert", user });
      return { ok: true };
    },
    [users, commitUsers, runOp]
  );

  const updateUser = useCallback(
    (username: string, patch: { password?: string; modules?: ModuleId[] }): { ok: boolean; error?: string } => {
      const key = normalizeUsername(username);
      const existing = users.find((u) => normalizeUsername(u.username) === key);
      if (!existing) return { ok: false, error: "That user no longer exists." };
      if (patch.password !== undefined && patch.password.length < 6) {
        return { ok: false, error: "Password must be at least 6 characters." };
      }
      if (patch.modules !== undefined && patch.modules.length === 0) {
        return { ok: false, error: "Pick at least one module for this user." };
      }
      const next: AppUser = {
        username: existing.username,
        password: patch.password ?? existing.password,
        modules: patch.modules ?? existing.modules,
      };
      commitUsers(users.map((u) => (normalizeUsername(u.username) === key ? next : u)));
      void runOp({ kind: "upsert", user: next });
      return { ok: true };
    },
    [users, commitUsers, runOp]
  );

  const removeUser = useCallback(
    (username: string) => {
      const key = normalizeUsername(username);
      commitUsers(users.filter((u) => normalizeUsername(u.username) !== key));
      void runOp({ kind: "delete", username });
    },
    [users, commitUsers, runOp]
  );

  const retrySync = useCallback(() => {
    if (pendingRef.current) void runOp(pendingRef.current);
  }, [runOp]);

  const canAccess = useCallback(
    (pageId: string): boolean => {
      if (!session) return false;
      if (pageId === "home") return true;
      if (pageId === "settings") return session.isAdmin;
      if (session.isAdmin) return true;
      return session.modules.includes(pageId as ModuleId);
    },
    [session]
  );

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      users,
      usersStatus,
      login,
      logout,
      addUser,
      updateUser,
      removeUser,
      retrySync,
      reloadUsers,
      canAccess,
    }),
    [ready, session, users, usersStatus, login, logout, addUser, updateUser, removeUser, retrySync, reloadUsers, canAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
