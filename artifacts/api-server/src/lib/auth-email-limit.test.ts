import assert from "node:assert/strict";
import test, { after } from "node:test";
import { once } from "node:events";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { CounterBackend } from "./tracking-limits";
import { createAuthEmailSendLimits } from "./auth-email-limit";

class CounterFixture implements CounterBackend {
  private readonly records = new Map<string, { hits: number; expiresAt: Date }>();

  async increment(scope: string, keyHash: string, windowMs: number, cap: number) {
    const key = `${scope}:${keyHash}`;
    let record = this.records.get(key);
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      record = { hits: 0, expiresAt: new Date(Date.now() + windowMs) };
      this.records.set(key, record);
    }
    record.hits = Math.min(record.hits + 1, cap);
    return { totalHits: record.hits, resetTime: record.expiresAt };
  }

  async delete(scope: string, keyHash: string) {
    this.records.delete(`${scope}:${keyHash}`);
  }
}

const servers: Server[] = [];
async function startServer(backend: CounterBackend, sendCounter: { sends: number }) {
  const app: Express = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post("/email", ...createAuthEmailSendLimits(backend), (_req, res) => {
    sendCounter.sends++;
    res.sendStatus(204);
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return server;
}

async function send(server: Server, ip: string, email: string) {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email }),
  });
  return { status: response.status, retryAfter: response.headers.get("retry-after") };
}

after(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>(resolve => server.close(() => resolve())),
  ));
});

test("only one auth email request per IP passes across API replicas during cooldown", async () => {
  process.env.SESSION_SECRET = "fictional-auth-email-test-secret";
  const backend = new CounterFixture();
  const sends = { sends: 0 };
  const firstReplica = await startServer(backend, sends);
  const secondReplica = await startServer(backend, sends);

  assert.equal((await send(firstReplica, "198.18.10.1", "customer@example.invalid")).status, 204);
  const sameIpDifferentAddress = await send(secondReplica, "198.18.10.1", "second@example.invalid");
  assert.equal(sameIpDifferentAddress.status, 429);
  assert.ok(Number(sameIpDifferentAddress.retryAfter) > 0);
  assert.equal(sends.sends, 1, "the duplicate request must not reach the email sender");

  const sameAddressDifferentIp = await send(secondReplica, "198.18.10.2", "customer@example.invalid");
  assert.equal(sameAddressDifferentIp.status, 429, "different IPs must not send repeated mail to one address");
  assert.equal(sends.sends, 1);

  assert.equal((await send(secondReplica, "198.18.10.3", "second@example.invalid")).status, 204);
  assert.equal(sends.sends, 2, "a different customer can request an email from a different IP");
});
