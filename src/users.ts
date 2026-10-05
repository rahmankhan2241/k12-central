import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * User accounts and module access.
 *
 * The admin account is built into the app (username + password below) and
 * always has full access. Everyone else gets an account created in
 * Settings → Access & Security, with a per-user list of modules.
 *
 * Accounts live in Supabase (app_users) with a local cache so the last known
 * user list still works when the database can't be reached. This is a soft
 * gate: the browser checks credentials, so keep the Supabase key private if
 * the data itself must stay secret.
 */

export type ModuleId =
  | "pending-grn"
  | "historic-report"
  | "po-tracking"
  | "vendors"
  | "shipments"
  | "inventory";

export const MODULES: { id: ModuleId; label: string; soon?: boolean }[] = [
  { id: "pending-grn", label: "Pending GRN Report" },
  { id: "historic-report", label: "Historic Report" },
  { id: "po-tracking", label: "PO Tracking" },
  { id: "vendors", label: "Vendors", soon: true },
  { id: "shipments", label: "Shipments", soon: true },
  { id: "inventory", label: "Inventory", soon: true },
];

export const ALL_MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

/** Modules a newly created account gets before the admin picks anything. */
export const DEFAULT_MODULE_IDS: ModuleId[] = ["historic-report"];

export const ADMIN_USERNAME = "R@hman2241";
export const ADMIN_PASSWORD = "R@hman2241";

export type AppUser = {
  username: string;
  password: string;
  modules: ModuleId[];
};

export type AuthSession = {
  username: string;
  isAdmin: boolean;
  modules: ModuleId[];
};

const USERS_CACHE_KEY = "k12.users.cache";
const SESSION_KEY = "k12.auth.session";

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

export function isAdminUsername(name: string): boolean {
  return normalizeUsername(name) === normalizeUsername(ADMIN_USERNAME);
}

export function isKnownModule(value: unknown): value is ModuleId {
  return typeof value === "string" && MODULES.some((m) => m.id === value);
}

export function moduleLabel(id: ModuleId): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export function formatModules(modules: ModuleId[]): string {
  return modules.map(moduleLabel).join(", ");
}

function sanitizeUser(row: unknown): AppUser | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.username !== "string" || !r.username.trim()) return null;
  if (typeof r.password !== "string" || r.password.length === 0) return null;
  const modules = Array.isArray(r.modules) ? r.modules.filter(isKnownModule) : [];
  return { username: r.username.trim(), password: r.password, modules };
}

export function readUsersCache(): AppUser[] {
  try {
    const raw = localStorage.getItem(USERS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeUser).filter((u): u is AppUser => u !== null);
  } catch {
    return [];
  }
}

export function cacheUsers(users: AppUser[]): void {
  try {
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
  } catch {
    // storage unavailable — the in-memory list still works for this session
  }
}

/** Reads the account list: DB first, then the local cache. failed=true when the DB wasn't reached. */
export async function loadUsers(): Promise<{ users: AppUser[]; failed: boolean }> {
  if (!isSupabaseConfigured) return { users: readUsersCache(), failed: true };
  try {
    const { data, error } = await supabase.from("app_users").select("username,password,modules");
    if (error) throw error;
    const users = (data ?? []).map(sanitizeUser).filter((u): u is AppUser => u !== null);
    cacheUsers(users);
    return { users, failed: false };
  } catch {
    return { users: readUsersCache(), failed: true };
  }
}

export async function saveUser(user: AppUser): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("app_users").upsert(
    {
      username: user.username,
      password: user.password,
      modules: user.modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "username" }
  );
  if (error) throw error;
}

export async function deleteUser(username: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("app_users").delete().eq("username", username);
  if (error) throw error;
}

export function readStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession> | null;
    if (!parsed || typeof parsed.username !== "string" || !parsed.username.trim()) return null;
    const isAdmin = parsed.isAdmin === true;
    const modules = Array.isArray(parsed.modules) ? parsed.modules.filter(isKnownModule) : [];
    return {
      username: parsed.username,
      isAdmin,
      modules: isAdmin ? ALL_MODULE_IDS : modules,
    };
  } catch {
    return null;
  }
}

export function writeStoredSession(session: AuthSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable — the session still works until this tab closes
  }
}
