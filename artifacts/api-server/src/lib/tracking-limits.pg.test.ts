import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import http, { type Server } from "node:http";
import express, { type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  createTrackingLimits, PostgresSecurityStore, pruneSecurityCounters,
  trackingStoreUnavailable, type CounterQuery,
} from "./tracking-limits";
import type { Options } from "express-rate-limit";

// Use the development DB, but only random security namespaces and fictional
// identifiers. No Shopify/Clerk requests or real order/customer records.
const namespace = `security-test:${randomUUID()}`;
const servers: Server[] = [];
async function connect() { return pool.connect(); }
const clients: Awaited<ReturnType<typeof connect>>[] = [];
const queries: CounterQuery[] = [];
let accepted = 0;
let sequence = 0;
const freshIp = () => `198.18.${Math.floor(++sequence / 250)}.${sequence % 250 + 1}`;

async function replica(execute: CounterQuery) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use((req, res, next) => {
    req.log = { error() {} } as unknown as Request["log"];
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.post("/tracking", ...createTrackingLimits(execute, namespace),
    trackingStoreUnavailable, (_req: Request, res: Response) => { accepted++; res.sendStatus(204); });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return server;
}

async function request(server: Server, ip: string, orderNumber: string, phone = "50000000") {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return new Promise<{ status: number; retry: number; cache: string | undefined }>((resolve, reject) => {
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
    req.setTimeout(10000, () => req.destroy(new Error("Test request timed out")));
    req.end(JSON.stringify({ orderNumber, phone }));
  });
}

before(async () => {
  for (let i = 0; i < 2; i++) {
    const client = await pool.connect();
    clients.push(client);
    // One query at a time per dedicated connection (pg 9 compatibility), while
    // the two independent connections still race against the same DB rows.
    let tail: Promise<unknown> = Promise.resolve();
    queries.push((text, values) => {
      const config = { text, values, query_timeout: 4000 };
      const result = tail.then(() => client.query(config));
      tail = result.catch(() => {});
      return result;
    });
    await replica(queries[i]);
  }
  const ids = await Promise.all(clients.map(client => client.query("SELECT pg_backend_pid() AS id")));
  assert.notEqual(ids[0].rows[0].id, ids[1].rows[0].id, "Independent PostgreSQL connections");
});

after(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) =>
    server.close(err => err ? reject(err) : resolve()))));
  try {
    await pool.query("DELETE FROM security_counters WHERE scope LIKE $1", [`${namespace}:%`]);
  } finally {
    for (const client of clients) client.release();
    await pool.end();
  }
});

function verifyBatch(results: Awaited<ReturnType<typeof request>>[], allowed: number, window: number) {
  assert.equal(results.filter(result => result.status === 204).length, allowed);
  assert.equal(results.filter(result => result.status === 429).length, results.length - allowed);
  for (const result of results) {
    assert.equal(result.cache, "no-store");
    if (result.status === 429) assert.ok(result.retry > 0 && result.retry <= window);
  }
}

test("simultaneous IP attempts share exactly ten slots across independent replicas and replacement instances", async () => {
  const ip = freshIp();
  const before = accepted;
  verifyBatch(await Promise.all(Array.from({ length: 50 }, (_, i) =>
    request(servers[i % 2], ip, `IPTEST${i}`))), 10, 900);
  assert.equal(accepted - before, 10);
  const replacement = await replica(queries[0]);
  assert.equal((await request(replacement, ip, "AFTERRESTART")).status, 429);
});

test("simultaneous normalized-order attempts share twenty slots across IPs, phones and replicas", async () => {
  const before = accepted;
  verifyBatch(await Promise.all(Array.from({ length: 60 }, (_, i) =>
    request(servers[i % 2], freshIp(), i % 2 ? "#SHAREDORDER" : " SHAREDORDER ",
      i % 2 ? "50000000" : "50000001"))), 20, 3600);
  assert.equal(accepted - before, 20);
  const replacement = await replica(queries[1]);
  assert.equal((await request(replacement, freshIp(), "SHAREDORDER")).status, 429);
});

test("IPv6 addresses in the same /56 share the IP budget", async () => {
  verifyBatch(await Promise.all(Array.from({ length: 25 }, (_, i) =>
    request(servers[i % 2], `2001:db8:1234:5600::${i + 1}`, `IPV6TEST${i}`))), 10, 900);
});

test("expiry resets atomically without extending active windows; expired identifiers are removed", async () => {
  const scope = `${namespace}:expiry`;
  const a = new PostgresSecurityStore(scope, 10, queries[0]);
  const b = new PostgresSecurityStore(scope, 10, queries[1]);
  for (const store of [a, b]) store.init({ windowMs: 900000 } as Options);
  const initial = await a.increment("fictional-identifier");
  const second = await b.increment("fictional-identifier");
  assert.equal(second.totalHits, 2);
  assert.equal(second.resetTime.getTime(), initial.resetTime.getTime());
  await clients[0].query(
    "UPDATE security_counters SET expires_at = statement_timestamp() - interval '1 second' WHERE scope = $1", [scope]);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    (i % 2 ? a : b).increment("fictional-identifier")));
  assert.deepEqual(results.map(row => row.totalHits).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(results[0].resetTime.getTime() >= initial.resetTime.getTime());
  await clients[0].query(
    "UPDATE security_counters SET expires_at = statement_timestamp() - interval '1 second' WHERE scope = $1", [scope]);
  // Exercise the real cleanup SQL but restrict it to this suite's namespace.
  const scopedCleanup: CounterQuery = (text, values) => queries[0](
    text.replace("ORDER BY expires_at LIMIT 10000", "AND scope = $1 ORDER BY expires_at LIMIT 10000"),
    [scope, ...values]);
  await pruneSecurityCounters(scopedCleanup);
  assert.equal((await clients[0].query("SELECT count(*) FROM security_counters WHERE scope = $1", [scope])).rows[0].count, "0");
  assert.equal((await a.increment("fictional-identifier")).totalHits, 1);
  await pruneSecurityCounters(scopedCleanup);
  assert.equal((await b.increment("fictional-identifier")).totalHits, 2, "Cleanup must preserve live counters");
});

test("stored security state contains only scoped HMACs, counts and expiration, not raw identifiers", async () => {
  const result = await clients[0].query("SELECT * FROM security_counters WHERE scope LIKE $1", [`${namespace}:%`]);
  assert.ok(result.rows.length > 0);
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row).sort(), ["expires_at", "hits", "key_hash", "scope"]);
    assert.match(row.key_hash, /^[a-f0-9]{64}$/);
  }
  assert.doesNotMatch(JSON.stringify(result.rows), /198\.18\.|SHAREDORDER|IPTEST|50000000|fictional-identifier/);
});

test("failed shared-store access never reaches the protected handler", async () => {
  const broken = await replica(async () => { throw new Error("Fictional DB failure"); });
  const before = accepted;
  const response = await request(broken, freshIp(), "FAILURE");
  assert.equal(response.status, 503);
  assert.equal(response.retry, 60);
  assert.equal(response.cache, "no-store");
  assert.equal(accepted, before);
});
