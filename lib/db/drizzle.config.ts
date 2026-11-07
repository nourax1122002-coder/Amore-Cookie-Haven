import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDatabaseConnection } from "./src/connection";

const database = resolveDatabaseConnection({
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
  NODE_ENV: "production",
});

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: database.connectionString,
  },
});
