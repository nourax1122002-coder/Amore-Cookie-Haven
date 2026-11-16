import { before, beforeEach, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server, type IncomingHttpHeaders } from "node:http";
import { Writable } from "node:stream";
import pino from "pino";
import { logger } from "../../src/lib/logger";
import { failCounters, resetMockFlavorIdeas } from "./mocks/db";

const phone = "+96550000000";
const address = "FICTIONAL-ADDRESS-CANARY";
const token = "FICTIONAL-CONFIRMATION-TOKEN";
const canaries = [phone, "96550000000", "50000000", address, token];
const privateKeys = /^(phone|address|tokenHash|confirmationToken|orderStatusUrl)$/i;
let server: Server;
let port: number;
let sequence = 1000;
let ip = 0;
let logs: string[] = [];
let responses: { status: number; headers: IncomingHttpHeaders; text: string; body: any }[] = [];
const realFetch = globalThis.fetch;

function checkNoDisclosure(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(privateKeys.test(key), false, `Private field exposed: ${key}`);
    if (key === "statusUrl") assert.equal(child, "");
    checkNoDisclosure(child);
  }
}
const freshOrder = () => `AM-TEST${++sequence}`;
const freshIp = () => `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}`;

before(async () => {
  Reflect.set(logger, pino.symbols.streamSym, new Writable({
    write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); },
  }));
  globalThis.fetch = async () => { throw new Error("Unexpected external network request in isolated HTTP tests."); };
  const { default: app } = await import("../../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  port = bound.port;
});

beforeEach(() => {
  logs = [];
  responses = [];
  failCounters(null);
  resetMockFlavorIdeas();
});

afterEach(async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(logs.length > 0, "HTTP request logs must be captured");
  for (const line of logs) checkNoDisclosure(JSON.parse(line));
  for (const response of responses) {
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(String(response.headers["content-type"]), /application\/json/);
    checkNoDisclosure(response.body);
  }
  const output = JSON.stringify({ logs, responses });
  for (const canary of canaries) assert.equal(output.includes(canary), false, "Private canary leaked in responses or logs");
});

after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

async function request(path: string, body?: unknown, user?: string, clientIp = freshIp(), method?: string) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const result = await new Promise<(typeof responses)[number]>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path,
       method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json", "X-Forwarded-For": clientIp,
        ...(user ? { "X-Test-User": user } : {}),
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, headers: res.headers, text, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("Test HTTP request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
  responses.push(result);
  return result;
}
const track = (orderNumber: string, submittedPhone = phone, clientIp?: string) =>
  request("/api/tracking", { orderNumber, phone: submittedPhone }, undefined, clientIp);

test("Supabase session endpoint returns no user to a guest without exposing credentials", async () => {
  const response = await request("/api/auth/session");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { user: null });
});

test("account order and favorite endpoints require an authenticated Supabase account", async () => {
  const requests = [
    ["/api/account/orders", undefined, "GET"],
    ["/api/account/favorites", undefined, "GET"],
    ["/api/account/favorites", { productId: "00000000-0000-4000-8000-000000000001" }, "POST"],
    ["/api/account/favorites", { productId: "00000000-0000-4000-8000-000000000001" }, "DELETE"],
  ] as const;
  for (const [path, body, method] of requests) {
    const response = await request(path, body, undefined, freshIp(), method);
    assert.equal(response.status, 401, `${method} ${path}: ${JSON.stringify(response.body)}`);
    assert.match(response.body.error, /sign in|تسجيل الدخول/i);
  }
});

test("Flavor Rewards lists public ideas but protects creator, account, AI, and administrator actions", async () => {
  const publicIdeas = await request("/api/flavor-rewards");
  assert.equal(publicIdeas.status, 200);
  assert.deepEqual(publicIdeas.body, []);

  const id = "00000000-0000-4000-8000-000000000001";
  const key = "00000000-0000-4000-8000-000000000002";
  const requests = [
    ["/api/flavor-rewards/mine", undefined, "GET"],
    ["/api/account/flavor-rewards", undefined, "GET"],
    ["/api/flavor-rewards/drafts", { title: "Rose chocolate", requestKey: key }, "POST"],
    [`/api/flavor-rewards/drafts/${id}`, {}, "PATCH"],
    [`/api/flavor-rewards/drafts/${id}/publish`, {}, "POST"],
    [`/api/flavor-rewards/${id}/interest`, {}, "POST"],
    ["/api/flavor-rewards/assistant", { language: "en", messages: [{ role: "user", content: "Suggest a cookie flavor." }] }, "POST"],
    ["/api/account/flavor-rewards/payout-requests", { amountFils: 1000, requestKey: key }, "POST"],
    ["/api/admin/flavor-rewards", undefined, "GET"],
    ["/api/admin/flavor-rewards/payment-reviews", undefined, "GET"],
    ["/api/admin/flavor-rewards/payment-reviews/evt_testreview1", { decision: "reviewed", note: "Checked event" }, "PATCH"],
    ["/api/admin/flavor-rewards/orders/fr-test-order/refunds", { component: "delivery", requestKey: key }, "POST"],
  ] as const;
  for (const [path, body, method] of requests) {
    const response = await request(path, body, undefined, freshIp(), method);
    assert.equal(response.status, 401, `${method} ${path}: ${JSON.stringify(response.body)}`);
  }
  assert.equal((await request("/api/admin/flavor-rewards", undefined, "visitor", freshIp(), "GET")).status, 403);
  assert.equal(
    (await request(
      "/api/admin/flavor-rewards/payment-reviews",
      undefined,
      "visitor",
      freshIp(),
      "GET",
    )).status,
    403,
  );
  assert.equal(
    (await request(
      "/api/admin/flavor-rewards/payment-reviews/evt_testreview1",
      { decision: "reviewed", note: "Checked event" },
      "visitor",
      freshIp(),
      "PATCH",
    )).status,
    403,
  );
});

test("Flavor Rewards allows one draft per account and keeps drafts private", async () => {
  const requestKey = "00000000-0000-4000-8000-000000000005";
  const first = await request("/api/flavor-rewards/drafts", {
    requestKey,
    title: "Rose chocolate",
    titleAr: "شوكولاتة الورد",
  }, "visitor");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.title, "Rose chocolate");

  const duplicate = await request("/api/flavor-rewards/drafts", {
    requestKey: "00000000-0000-4000-8000-000000000006",
    title: "Another flavor",
    titleAr: "نكهة أخرى",
  }, "visitor");
  assert.equal(duplicate.status, 409);

  const otherAccount = await request("/api/flavor-rewards/drafts", {
    requestKey: "00000000-0000-4000-8000-000000000007",
    title: "Vanilla rose",
    titleAr: "فانيلا الورد",
  }, "another");
  assert.equal(otherAccount.status, 201, JSON.stringify(otherAccount.body));

  const visitorIdeas = await request("/api/flavor-rewards/mine", undefined, "visitor", freshIp(), "GET");
  const otherIdeas = await request("/api/flavor-rewards/mine", undefined, "another", freshIp(), "GET");
  assert.equal(visitorIdeas.status, 200);
  assert.deepEqual(visitorIdeas.body.map((idea: { title: string }) => idea.title), ["Rose chocolate"]);
  assert.equal(otherIdeas.status, 200);
  assert.deepEqual(otherIdeas.body.map((idea: { title: string }) => idea.title), ["Vanilla rose"]);
});

test("simultaneous draft requests for one account produce only one saved idea", async () => {
  const body = (requestKey: string, title: string) => ({
    requestKey,
    title,
    titleAr: "نكهة اختبار",
  });
  const results = await Promise.all([
    request("/api/flavor-rewards/drafts", body("00000000-0000-4000-8000-000000000011", "First"), "race-user"),
    request("/api/flavor-rewards/drafts", body("00000000-0000-4000-8000-000000000012", "Second"), "race-user"),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const ideas = await request("/api/flavor-rewards/mine", undefined, "race-user", freshIp(), "GET");
  assert.equal(ideas.status, 200);
  assert.equal(ideas.body.length, 1);
});

test("unverified interests, manual sales, and payouts fail closed without database writes", async () => {
  const ideaId = "00000000-0000-4000-8000-000000000009";
  const interest = await request(`/api/flavor-rewards/${ideaId}/interest`, {}, "visitor");
  assert.equal(interest.status, 409);
  assert.match(interest.body.error, /paused/i);

  const payout = await request("/api/account/flavor-rewards/payout-requests", {
    amountFils: 1000,
    requestKey: "00000000-0000-4000-8000-000000000010",
  }, "visitor");
  assert.equal(payout.status, 409);

  const manualSale = await request(`/api/admin/flavor-rewards/${ideaId}/sales`, {
    sourceReference: "manual reference",
    netSalesFils: 1000,
  }, "owner");
  assert.equal(manualSale.status, 409);

  const payoutReview = await request(
    `/api/admin/flavor-rewards/payout-requests/${ideaId}`,
    { status: "paid" },
    "owner",
    freshIp(),
    "PATCH",
  );
  assert.equal(payoutReview.status, 409);
});

test("account order history returns only the signed-in user's safe order details", async () => {
  const visitor = await request("/api/account/orders", undefined, "visitor", freshIp(), "GET");
  const another = await request("/api/account/orders", undefined, "another", freshIp(), "GET");

  assert.equal(visitor.status, 200);
  assert.deepEqual(visitor.body.map((order: { number: string }) => order.number), ["AM-ACCOUNT-VISITOR"]);
  assert.equal(visitor.body[0].total, "12.500");
  assert.deepEqual(visitor.body[0].items, [{ title: "Chocolate cookie", quantity: 2 }]);
  assert.equal(another.status, 200);
  assert.deepEqual(another.body.map((order: { number: string }) => order.number), ["AM-ACCOUNT-ANOTHER"]);
});

test("API artifact base path and health endpoint respond successfully", async () => {
  const base = await request("/api");
  assert.equal(base.status, 200);
  assert.deepEqual(base.body, { status: "ok" });
  const health = await request("/api/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: "ok" });
});

test("admin order data is private to approved administrators", async () => {
  assert.equal((await request("/api/admin/local-orders")).status, 401);
  assert.equal((await request("/api/admin/local-orders", undefined, "visitor")).status, 403);
  assert.equal((await request("/api/admin/local-orders", undefined, "unverified-owner")).status, 403);
  const owner = await request("/api/admin/local-orders", undefined, "owner");
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body, []);
});

test("tracking never reveals an unknown order or its submitted phone", async () => {
  const response = await track(freshOrder());
  assert.equal(response.status, 200);
  assert.equal(response.body.available, false);
  assert.equal(response.body.statusUrl, "");
  assert.equal("order" in response.body, false);
});

test("tracking rejects wrong phone and missing order with the same public response", async () => {
  const missing = await track(freshOrder());
  const wrongPhone = await track(freshOrder(), "+96550000001");
  assert.equal(missing.text, wrongPhone.text);
  assert.equal(wrongPhone.body.available, false);
});

test("tracking applies an IP rate limit and returns retry timing", async () => {
  const clientIp = freshIp();
  for (let i = 0; i < 10; i++) assert.equal((await track(freshOrder(), phone, clientIp)).status, 200);
  const response = await track(freshOrder(), phone, clientIp);
  assert.equal(response.status, 429);
  assert.match(String(response.headers["retry-after"]), /^\d+$/);
  assert.ok(Number(response.headers["retry-after"]) > 0);
});

for (const scope of ["tracking:ip", "tracking:order"]) {
  test(`tracking fails closed when ${scope} storage is unavailable`, async () => {
    failCounters(scope);
    const response = await track(freshOrder());
    assert.equal(response.status, 503);
    assert.equal(response.headers["retry-after"], "60");
    failCounters(null);
    assert.equal((await track(freshOrder())).status, 200);
  });
}

test("tracking fails closed without the shared hashing secret", async () => {
  const secret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    const response = await track(freshOrder());
    assert.equal(response.status, 503);
    assert.equal(response.headers["retry-after"], "60");
  } finally {
    process.env.SESSION_SECRET = secret;
  }
});

test("admin authorization never calls a third-party API", async () => {
  assert.equal((await request("/api/admin/me", undefined, "owner")).body.isAdmin, true);
});
