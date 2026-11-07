import test from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseConnection } from "./connection.ts";

test("Supabase connection takes priority when configured", () => {
  assert.deepEqual(resolveDatabaseConnection({
    SUPABASE_DATABASE_URL: "postgres://user:password@db.example.supabase.co:5432/postgres",
    DATABASE_URL: "postgres://replit",
  }), {
    connectionString: "postgres://user:password@db.example.supabase.co:5432/postgres",
    target: "supabase",
  });
});

test("managed Replit database remains the development fallback", () => {
  assert.deepEqual(resolveDatabaseConnection({ DATABASE_URL: "postgres://replit" }), {
    connectionString: "postgres://replit", target: "replit",
  });
});

test("an invalid Supabase URL falls back only in development and is reported", () => {
  assert.deepEqual(resolveDatabaseConnection({
    SUPABASE_DATABASE_URL: "https://example.supabase.co",
    DATABASE_URL: "postgres://replit",
    NODE_ENV: "development",
  }), {
    connectionString: "postgres://replit",
    target: "replit",
    configurationIssue: "invalid-supabase-url",
  });
  assert.throws(() => resolveDatabaseConnection({
    SUPABASE_DATABASE_URL: "https://example.supabase.co",
    DATABASE_URL: "postgres://replit",
    NODE_ENV: "production",
  }), /valid Supabase PostgreSQL connection URL/);
});

test("missing database configuration fails explicitly", () => {
  assert.throws(() => resolveDatabaseConnection({}), /Set SUPABASE_DATABASE_URL or DATABASE_URL/);
});
