import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
export type SupabaseConfigurationCode =
  | "SUPABASE_URL_MISSING"
  | "SUPABASE_URL_INVALID"
  | "SUPABASE_SECRET_KEY_MISSING"
  | "SUPABASE_SECRET_KEY_INVALID";

export class SupabaseConfigurationError extends Error {
  readonly code: SupabaseConfigurationCode;

  constructor(code: SupabaseConfigurationCode) {
    const message = code.startsWith("SUPABASE_URL")
      ? "Supabase project API URL is missing or invalid."
      : "Supabase secret API key is missing or invalid.";
    super(message);
    this.name = "SupabaseConfigurationError";
    this.code = code;
  }
}

function supabaseCredentials() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url) throw new SupabaseConfigurationError("SUPABASE_URL_MISSING");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new SupabaseConfigurationError("SUPABASE_URL_INVALID");
  }
  if (!key) throw new SupabaseConfigurationError("SUPABASE_SECRET_KEY_MISSING");
  if (!key.startsWith("sb_secret_")) {
    throw new SupabaseConfigurationError("SUPABASE_SECRET_KEY_INVALID");
  }
  return { url, key };
}
function makeClient() {
  const { url, key } = supabaseCredentials();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "public" },
  });
}
function getClient() {
  if (client) return client;
  client = makeClient();
  return client;
}

// This client is server-only. Never import it from browser bundles or expose
// the secret key through Vite environment variables.
export function assertSupabaseConfiguration() { void getClient(); }
// Auth requests use an isolated client so one user's session cannot affect
// the service client's headers or another concurrent auth operation.
export function createSupabaseAuthClient() { return makeClient(); }
// Use a fresh client for each authenticated request. The secret key remains
// server-side in the apikey header while the caller JWT is the Authorization
// identity, so Postgres evaluates that user's RLS policies.
export function createSupabaseUserClient(accessToken: string) {
  if (!accessToken || accessToken.length > 8192 || /[\r\n]/.test(accessToken)) {
    throw new Error("A valid Supabase user access token is required.");
  }
  const { url, key } = supabaseCredentials();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "public" },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
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
