import test from "node:test";
import assert from "node:assert/strict";
import { fromDatabaseRow, toDatabaseRow } from "./supabase.ts";

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
