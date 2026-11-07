import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
function getClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error("A valid SUPABASE_URL is required for the database client.");
  }
  if (!key?.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SECRET_KEY must be a Supabase secret API key.");
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "public" },
  });
  return client;
}

// This client is server-only. Never import it from browser bundles or expose
// the secret key through Vite environment variables.
export function assertSupabaseConfiguration() { void getClient(); }
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const value = Reflect.get(getClient(), property);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});

export function unwrap<T>(
  result: { data: T | null; error: { code?: string } | null },
  operation: string,
): T {
  if (result.error) {
    const error = new Error(`Supabase ${operation} failed.`);
    Object.assign(error, { code: result.error.code });
    throw error;
  }
  return result.data as T;
}

export function toDatabaseRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), item,
  ]));
}

export function fromDatabaseRow<T>(value: Record<string, unknown>): T {
  const row = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), item,
  ]));
  for (const key of ["createdAt", "updatedAt", "expiresAt"] as const) {
    if (typeof row[key] === "string") row[key] = new Date(row[key] as string);
  }
  return row as T;
}
