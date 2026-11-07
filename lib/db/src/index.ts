import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { resolveDatabaseConnection } from "./connection";
import * as schema from "./schema";

const { Pool } = pg;
const database = resolveDatabaseConnection(process.env);
export const databaseTarget = database.target;
export const pool = new Pool({
  connectionString: database.connectionString,
  max: 5,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
