import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http, { type Server } from "node:http";
import express, { type Request, type Response } from "express";
import {
  createTrackingLimits, SupabaseSecurityStore, trackingStoreUnavailable, type CounterBackend,
} from "./tracking-limits";
import type { Options } from "express-rate-limit";

class MemoryCounterBackend implements CounterBackend {
  readonly records = new Map<string, { hits: number; expiresAt: Date }>();
  fail = false;
  async increment(scope: string, hash: string, windowMs: number, cap: number) {
    if (this.fail) throw new Error("fixture store unavailable");
    const id = `${scope}:${hash}`;
    let row = this.records.get(id);
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      row = { hits: 0, expiresAt: new Date(Date.now() + windowMs) };
      this.records.set(id, row);
    }
    row.hits = Math.min(row.hits + 1, cap);
    return { totalHits: row.hits, resetTime: row.expiresAt };
  }
  async delete(scope: string, hash: string) { this.records.delete(`${scope}:${hash}`); }
}

const servers: Server[] = [];
async function replica(backend: CounterBackend, namespace: string) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error() {} } as unknown as Request["log"]; next(); });
  app.post("/tracking", ...createTrackingLimits(backend, namespace), trackingStoreUnavailable,
    (_req: Request, res: Response) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return server;
}
async function request(server: Server, ip: string, orderNumber: string) {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return new Promise<{ status: number; retry: number; cache?: string }>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: address.port, path: "/tracking", method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    }, res => {
      res.resume();
      res.on("end", () => resolve({
        status: res.statusCode!, retry: Number(res.headers["retry-after"]),
        cache: res.headers["cache-control"],
      }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("fixture timeout")));
    req.end(JSON.stringify({ orderNumber, phone: "fictional-phone" }));
  });
}
test("shared Supabase counter backend enforces limits across API replicas", async t => {
  t.after(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
  const backend = new MemoryCounterBackend();
  const a = await replica(backend, "tracking-test");
  const b = await replica(backend, "tracking-test");
  let last;
  for (let i = 0; i < 20; i++) {
    const ip = `198.18.${Math.floor(i / 250)}.${i % 250 + 1}`;
    last = await request(i % 2 ? a : b, ip, "AM-SHARED");
    assert.equal(last.status, 204);
  }
  const limited = await request(a, "198.18.2.9", "AM-SHARED");
  assert.equal(limited.status, 429);
  assert.ok(limited.retry > 0);
  assert.ok([...backend.records.keys()].every(key => !key.includes("198.18.") && !key.includes("AM-SHARED")));
});
test("security store resets expired counters and never stores raw identifiers", async () => {
  process.env.SESSION_SECRET = "fixture-only-hmac-secret";
  const backend = new MemoryCounterBackend();
  const store = new SupabaseSecurityStore("tracking:unit", 2, backend);
  store.init({ windowMs: 20 } as Options);
  const first = await store.increment("fictional-order");
  assert.equal(first.totalHits, 1);
  assert.ok([...backend.records.keys()].every(key => !key.includes("fictional-order")));
  await store.resetKey("fictional-order");
  assert.equal(backend.records.size, 0);
});
test("a failed shared-store request fails closed before reaching the handler", async t => {
  t.after(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
  const backend = new MemoryCounterBackend();
  backend.fail = true;
  const server = await replica(backend, "tracking-test-failure");
  const result = await request(server, "198.18.9.1", "AM-FAIL");
  assert.equal(result.status, 503);
  assert.equal(result.retry, 60);
  assert.equal(result.cache, "no-store");
});
