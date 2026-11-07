export type DatabaseEnvironment = {
  SUPABASE_DATABASE_URL?: string;
  DATABASE_URL?: string;
};

export function resolveDatabaseConnection(env: DatabaseEnvironment) {
  const supabaseUrl = env.SUPABASE_DATABASE_URL?.trim();
  if (supabaseUrl) return { connectionString: supabaseUrl, target: "supabase" as const };

  const replitUrl = env.DATABASE_URL?.trim();
  if (replitUrl) return { connectionString: replitUrl, target: "replit" as const };

  throw new Error("Set SUPABASE_DATABASE_URL or DATABASE_URL before starting the database client.");
}
