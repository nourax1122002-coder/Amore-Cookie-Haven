import { before, beforeEach, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server, type IncomingHttpHeaders } from "node:http";
import { Writable } from "node:stream";
import pino from "pino";
import { logger } from "../../src/lib/logger";
import type { ShopifyOrder } from "../../src/lib/orders";

// Fictional canaries deliberately include fields not requested by our GraphQL
// query. They must be stripped even if an upstream payload contains extra data.
const phone = "+96550000000";
const wrongPhone = "+96550000001";
const address = "FICTIONAL-ADDRESS-CANARY";
const token = "FICTIONAL-CONFIRMATION-TOKEN";
const statusUrl = `https://orders.example.invalid/confirmation/${token}`;
const canaries = [
  phone, "96550000000", "50000000", wrongPhone, "50000001", address, token, statusUrl,
];
const forbiddenKeys = /^(phone|shippingAddress|billingAddress|address1|address2|confirmationNumber|confirmationToken|orderStatusUrl)$/i;
const fixture = (name: string) => ({
  name, phone, shippingAddress: { phone, address1: address },
  billingAddress: { phone, address1: address },
  confirmationNumber: token, confirmationToken: token, orderStatusUrl: statusUrl,
  confirmed: true, cancelledAt: null, createdAt: "2026-01-01T10:00:00Z",
  displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
  currentTotalPriceSet: { shopMoney: { amount: "10.000", currencyCode: "KWD" } },
  lineItems: { nodes: [{ title: "Fictional cookie", quantity: 2 }], pageInfo: { hasNextPage: false } },
  fulfillments: [],
});

let server: Server;
let port: number;
let ip = 0;
let sequence = 1000;
let nodes: ShopifyOrder[] = [];
let mode: "ok" | "protected" | "network" | "http-denied" = "ok";
let calls: { query: string; variables: Record<string, unknown> }[] = [];
let logs: string[] = [];
let responses: { status: number; headers: IncomingHttpHeaders; text: string; body: any }[] = [];
const realFetch = globalThis.fetch;
const freshOrder = () => `#TEST${++sequence}`;
const freshIp = () => `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}`;

function checkNoDisclosure(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenKeys.test(key), false, `Private field exposed: ${key}`);
    if (key === "statusUrl") assert.equal(child, "");
    checkNoDisclosure(child);
  }
}

before(async () => {
  // Preserve the real production Pino configuration and app serializers while
  // replacing only its output destination, before pino-http creates children.
  Reflect.set(logger, pino.symbols.streamSym, new Writable({
    write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); },
  }));
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://shopify.example.invalid/api/v2/proxy/admin/api/2026-04/graphql.json");
    assert.equal(options?.method, "POST");
    const request = JSON.parse(String(options?.body));
    assert.match(request.query, /query (TrackOrder|AdminOrders)\(/);
    calls.push(request);
    // Error messages carry canaries too: never relay or log upstream details.
    if (mode === "network") throw new Error(`Network failure ${phone} ${address} ${statusUrl}`);
    return new Response(JSON.stringify({
      data: { orders: { nodes, pageInfo: { hasNextPage: true, endCursor: "fictional-next-cursor" } } },
      ...(mode === "protected" || mode === "http-denied"
        ? { errors: [{ message: `Protected customer data denied ${phone} ${address} ${statusUrl}`,
          extensions: { code: "ACCESS_DENIED" } }] } : {}),
    }), { status: mode === "http-denied" ? 403 : 200 });
  };
  const { default: app } = await import("../../src/app");
  // An isolated ephemeral HTTP server, not the running store or its proxy.
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  port = bound.port;
});

beforeEach(() => {
  mode = "ok"; nodes = []; calls = []; logs = []; responses = [];
});

afterEach(async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(logs.length > 0, "Real HTTP request logs must be captured");
  for (const line of logs) checkNoDisclosure(JSON.parse(line));
  for (const response of responses) {
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(String(response.headers["content-type"]), /application\/json/);
    checkNoDisclosure(response.body);
  }
  const output = JSON.stringify({ logs, responses });
  for (const canary of canaries) assert.equal(output.includes(canary), false, "Private canary leaked in response or logs");
});

after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

async function request(path: string, body?: unknown, user?: string, clientIp = freshIp()) {
  const result = await new Promise<(typeof responses)[number]>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path,
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json", "X-Forwarded-For": clientIp,
        ...(user ? { "X-Test-User": user } : {}),
      },
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, headers: res.headers, text, body: JSON.parse(text) }); }
        catch (err) { reject(err); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("Test HTTP request timed out")));
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  responses.push(result);
  return result;
}
const track = (orderNumber: string, submittedPhone = phone, clientIp?: string) =>
  request("/api/tracking", { orderNumber, phone: submittedPhone }, undefined, clientIp);

test("admin orders: anonymous is 401; verified non-owner and unverified owner are 403 without Shopify calls", async () => {
  assert.equal((await request("/api/admin/orders")).status, 401);
  for (const user of ["visitor", "unverified-owner"]) {
    assert.equal((await request("/api/admin/orders", undefined, user)).status, 403);
  }
  assert.equal(calls.length, 0);
});

test("admin orders: approved owner receives only live sanitized summaries and pagination", async () => {
  nodes = [fixture(freshOrder())];
  const response = await request("/api/admin/orders?after=fictional-previous-cursor", undefined, "owner");
  assert.equal(response.status, 200);
  assert.equal(response.body.orders.length, 1);
  assert.equal(response.body.orders[0].total, "10.000");
  assert.equal(response.body.orders[0].currency, "KWD");
  assert.equal(response.body.orders[0].stage, "confirmed");
  assert.equal(response.body.hasNextPage, true);
  assert.equal(response.body.endCursor, "fictional-next-cursor");
  assert.ok(Number.isFinite(Date.parse(response.body.refreshedAt)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].variables.after, "fictional-previous-cursor");
  assert.doesNotMatch(calls[0].query, /\b(phone|shippingAddress|billingAddress|orderStatusUrl|confirmationNumber)\b/);
});

test("tracking: successful phone verification exposes a minimal summary, not customer data or confirmation links", async () => {
  const number = freshOrder();
  nodes = [fixture(number)];
  const response = await track(number);
  assert.equal(response.status, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.statusUrl, "");
  assert.equal(response.body.order.number, number);
  assert.equal(response.body.order.total, "10.000");
  assert.deepEqual(response.body.order.items, [{ title: "Fictional cookie", quantity: 2 }]);
  assert.equal(calls.length, 1);
});

test("tracking: missing, wrong phone, ambiguous, approximate and missing-phone orders have identical public responses", async () => {
  const number = freshOrder();
  const missing = await track(number);
  assert.equal(missing.status, 200);
  assert.equal(missing.body.available, false);
  assert.equal(missing.body.statusUrl, "");
  assert.equal("order" in missing.body, false);
  nodes = [fixture(number)];
  const wrong = await track(number, wrongPhone);
  nodes = [fixture(number), fixture(number)];
  const ambiguous = await track(number);
  nodes = [fixture(`${number}0`)];
  const approximate = await track(number);
  nodes = [{ ...fixture(number), phone: null, shippingAddress: null }];
  const noPhone = await track(number);
  for (const result of [wrong, ambiguous, approximate, noPhone]) {
    assert.equal(result.status, missing.status);
    assert.equal(result.text, missing.text);
  }
  assert.equal(calls.length, 5);
});

test("tracking: IP limit permits ten attempts then returns 429 with Retry-After and no-store, without upstream work", async () => {
  const clientIp = freshIp();
  for (let i = 0; i < 10; i++) assert.equal((await track(freshOrder(), phone, clientIp)).status, 200);
  const response = await track(freshOrder(), phone, clientIp);
  assert.equal(response.status, 429);
  assert.match(String(response.headers["retry-after"]), /^\d+$/);
  assert.ok(Number(response.headers["retry-after"]) > 0 && Number(response.headers["retry-after"]) <= 900);
  assert.equal(calls.length, 10);
});

test("tracking: order limit spans IPs, phone variations and optional hash prefix", async () => {
  const number = freshOrder();
  for (let i = 0; i < 20; i++) {
    const response = await track(i % 2 ? number.slice(1) : number, i % 2 ? wrongPhone : phone);
    assert.equal(response.status, 200);
  }
  const response = await track(number);
  assert.equal(response.status, 429);
  assert.match(String(response.headers["retry-after"]), /^\d+$/);
  assert.ok(Number(response.headers["retry-after"]) > 0 && Number(response.headers["retry-after"]) <= 3600);
  assert.equal(calls.length, 20);
});

for (const failure of ["protected", "http-denied", "network"] as const) {
  test(`both endpoints fail closed with 503 on Shopify ${failure}, even with partial order data`, async () => {
    const number = freshOrder();
    nodes = [fixture(number)];
    mode = failure;
    const tracking = await track(number);
    const admin = await request("/api/admin/orders", undefined, "owner");
    for (const response of [tracking, admin]) {
      assert.equal(response.status, 503);
      assert.deepEqual(Object.keys(response.body), ["error"]);
      assert.equal(typeof response.body.error, "string");
    }
    assert.equal(tracking.text, admin.text);
    assert.equal(calls.length, 2);
  });
}
