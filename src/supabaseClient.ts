import { createClient } from "@supabase/supabase-js";

/**
 * Supabase configuration.
 *
 * The anon/publishable key is safe to ship in client code: the database has
 * RLS policies that restrict what the anonymous role can touch. VITE_ env
 * vars can still override these (e.g. to point at a different project).
 */
const FALLBACK_URL = "https://dovbrtzcxicfudskwyat.supabase.co";
const FALLBACK_KEY = "sb_publishable_wW7bNbkC_spopcCSLavzJA_bsSRQXlE";

// Use || (not ??) so empty-string env vars also fall back — Vercel projects
// sometimes carry blank env vars, and createClient rejects empty URLs.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || FALLBACK_URL;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || FALLBACK_KEY;

export const isSupabaseConfigured = Boolean(url && key);

export const supabase = createClient(url, key);
