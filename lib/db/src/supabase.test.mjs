import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseUserClient, fromDatabaseRow, toDatabaseRow } from "./supabase.ts";

test("maps repository fields between TypeScript and Supabase PostgREST columns", () => {
  assert.deepEqual(toDatabaseRow({
    requestKey: "fixture-key", updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    address: { area: "Fixture", block: "1" },
  }), {
    request_key: "fixture-key", updated_at: new Date("2026-01-01T00:00:00.000Z"),
    address: { area: "Fixture", block: "1" },
  });
  const row = fromDatabaseRow({
    created_at: "2026-01-01T00:00:00.000Z", expires_at: "2026-01-02T00:00:00.000Z",
    request_hash: "fictional-hash", address: { area: "Fixture" },
  });
  assert.equal(row.requestHash, "fictional-hash");
  assert.ok(row.createdAt instanceof Date);
  assert.ok(row.expiresAt instanceof Date);
  assert.deepEqual(row.address, { area: "Fixture" });
});

test("user-scoped database requests preserve the user JWT for RLS", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  const originalFetch = globalThis.fetch;
  const key = "sb_secret_fixture_only_not_a_credential";
  const token = "fictional.user.jwt";
  let captured;
  process.env.SUPABASE_URL = "https://fixture-project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = key;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), headers: new Headers(init?.headers) };
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const client = createSupabaseUserClient(token);
    const { data, error } = await client.from("orders").select("id");
    assert.equal(error, null);
    assert.deepEqual(data, []);
    assert.ok(captured);
    assert.equal(captured.headers.get("authorization"), `Bearer ${token}`);
    assert.equal(captured.headers.get("apikey"), key);
    assert.equal(new URL(captured.url).searchParams.has("user_id"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});
