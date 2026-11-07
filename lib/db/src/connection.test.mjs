import test from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseConnection } from "./connection.ts";

test("Supabase connection takes priority when configured", () => {
  assert.deepEqual(resolveDatabaseConnection({
    SUPABASE_DATABASE_URL: "postgres://supabase",
    DATABASE_URL: "postgres://replit",
  }), { connectionString: "postgres://supabase", target: "supabase" });
});

test("managed Replit database remains the development fallback", () => {
  assert.deepEqual(resolveDatabaseConnection({ DATABASE_URL: "postgres://replit" }), {
    connectionString: "postgres://replit", target: "replit",
  });
});

test("missing database configuration fails explicitly", () => {
  assert.throws(() => resolveDatabaseConnection({}), /Set SUPABASE_DATABASE_URL or DATABASE_URL/);
});
