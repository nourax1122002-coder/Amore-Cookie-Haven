export type DatabaseEnvironment = {
  SUPABASE_DATABASE_URL?: string;
  DATABASE_URL?: string;
  NODE_ENV?: string;
};

export type DatabaseConnection = {
  connectionString: string;
  target: "supabase" | "replit";
  configurationIssue?: "invalid-supabase-url";
};

function isSupabasePostgresUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:")
      && (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".pooler.supabase.com"))
      && url.username.length > 0
      && url.password.length > 0
      && url.pathname.length > 1;
  } catch {
    return false;
  }
}

export function resolveDatabaseConnection(env: DatabaseEnvironment): DatabaseConnection {
  const supabaseUrl = env.SUPABASE_DATABASE_URL?.trim();
  if (supabaseUrl && isSupabasePostgresUrl(supabaseUrl)) {
    return { connectionString: supabaseUrl, target: "supabase" as const };
  }

  const replitUrl = env.DATABASE_URL?.trim();
  if (supabaseUrl && env.NODE_ENV === "production") {
    throw new Error("SUPABASE_DATABASE_URL must be a valid Supabase PostgreSQL connection URL in production.");
  }
  if (replitUrl) return {
    connectionString: replitUrl,
    target: "replit" as const,
    ...(supabaseUrl ? { configurationIssue: "invalid-supabase-url" as const } : {}),
  };

  throw new Error("Set SUPABASE_DATABASE_URL or DATABASE_URL before starting the database client.");
}
