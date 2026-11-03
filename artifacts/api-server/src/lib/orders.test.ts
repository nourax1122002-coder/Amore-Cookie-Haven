import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { listOrders, normalizeOrderNumber, normalizePhone, phoneMatches, presentOrder, trackOrder, type ShopifyOrder } from "./orders";

// Entirely fictional fixture. No store mutation, payment or customer data.
const fixture = (changes: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
  name: "#1001", phone: "+96550000000", shippingAddress: null,
  confirmed: false, cancelledAt: null, createdAt: "2026-01-01T10:00:00Z",
  displayFinancialStatus: "PENDING", displayFulfillmentStatus: "UNFULFILLED",
  currentTotalPriceSet: { shopMoney: { amount: "10.000", currencyCode: "KWD" } },
  lineItems: { nodes: [{ title: "Test cookie", quantity: 1 }], pageInfo: { hasNextPage: false } },
  fulfillments: [], ...changes,
});
const originalFetch = globalThis.fetch;
const originalHost = process.env.REPLIT_CONNECTORS_HOSTNAME;
const originalIdentity = process.env.REPL_IDENTITY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHost === undefined) delete process.env.REPLIT_CONNECTORS_HOSTNAME; else process.env.REPLIT_CONNECTORS_HOSTNAME = originalHost;
  if (originalIdentity === undefined) delete process.env.REPL_IDENTITY; else process.env.REPL_IDENTITY = originalIdentity;
});
function mockOrders(nodes: ShopifyOrder[], errors?: unknown[]) {
  process.env.REPLIT_CONNECTORS_HOSTNAME = "localhost";
  process.env.REPL_IDENTITY = "fictional-test-identity";
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { orders: { nodes, pageInfo: { hasNextPage: true, endCursor: "test-cursor" } } }, errors,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("phones normalize Kuwait local, international, Arabic/Persian digits, but never suffix-match", () => {
  for (const phone of ["50000000", "+965 5000-0000", "0096550000000", "٥٠٠٠٠٠٠٠", "۵۰۰۰۰۰۰۰"]) {
    assert.equal(normalizePhone(phone), "96550000000");
    assert.equal(phoneMatches(phone, fixture()), true);
  }
  assert.equal(phoneMatches("+96650000000", fixture()), false);
  assert.equal(phoneMatches("00000000", fixture({ phone: null })), false);
  assert.equal(normalizePhone("hello50000000"), null);
  assert.equal(phoneMatches("50000000", fixture({ phone: null, shippingAddress: { phone: "+96550000000" } })), true);
});
test("order identifiers reject Shopify search injection", () => {
  assert.equal(normalizeOrderNumber(" #١٠٠١ "), "#1001");
  for (const input of ['1001" OR status:any', "1001 OR 1002", "*", "name:1001", ""]) assert.equal(normalizeOrderNumber(input), null);
});
test("all stages come from Shopify and fulfilled is not delivered", () => {
  assert.equal(presentOrder(fixture()).stage, "received");
  assert.equal(presentOrder(fixture({ confirmed: true })).stage, "confirmed");
  assert.equal(presentOrder(fixture({ displayFulfillmentStatus: "IN_PROGRESS" })).stage, "preparing");
  assert.equal(presentOrder(fixture({ displayFulfillmentStatus: "PARTIALLY_FULFILLED" })).stage, "partially_fulfilled");
  assert.equal(presentOrder(fixture({ displayFulfillmentStatus: "FULFILLED" })).stage, "shipped");
  assert.equal(presentOrder(fixture({ fulfillments: [{ displayStatus: "IN_TRANSIT" }] })).stage, "shipped");
  assert.equal(presentOrder(fixture({ fulfillments: [{ displayStatus: "OUT_FOR_DELIVERY" }] })).stage, "out_for_delivery");
  assert.equal(presentOrder(fixture({ displayFulfillmentStatus: "FULFILLED", fulfillments: [{ displayStatus: "DELIVERED" }] })).stage, "delivered");
  assert.notEqual(presentOrder(fixture({ displayFulfillmentStatus: "PARTIALLY_FULFILLED", fulfillments: [{ displayStatus: "DELIVERED" }] })).stage, "delivered");
  assert.equal(presentOrder(fixture({ cancelledAt: "2026-01-02", displayFulfillmentStatus: "FULFILLED" })).stage, "cancelled");
});
test("successful lookup emits only minimal order data, never phone/address/status token", async () => {
  mockOrders([fixture()]);
  const result = await trackOrder("1001", "50000000");
  assert.equal(result.available, true);
  assert.equal(result.statusUrl, "");
  assert.ok("order" in result);
  assert.equal(result.order?.number, "#1001");
  assert.equal(result.order?.total, "10.000");
  assert.ok(!JSON.stringify(result).includes("50000000"));
  assert.ok(!("shippingAddress" in result.order!));
});
test("missing order, wrong phone, approximate name and ambiguous results are indistinguishable", async () => {
  mockOrders([]);
  const miss = await trackOrder("1001", "50000000");
  mockOrders([fixture()]);
  assert.deepEqual(await trackOrder("1001", "50000001"), miss);
  mockOrders([fixture({ name: "#10010" })]);
  assert.deepEqual(await trackOrder("1001", "50000000"), miss);
  mockOrders([fixture(), fixture()]);
  assert.deepEqual(await trackOrder("1001", "50000000"), miss);
  mockOrders([fixture({ phone: null })]);
  assert.deepEqual(await trackOrder("1001", "50000000"), miss);
});
test("protected-data errors fail closed and never masquerade as missing order", async () => {
  mockOrders([fixture()], [{ message: "phone field denied" }]);
  await assert.rejects(trackOrder("1001", "50000000"), (err: unknown) => (err as { status: number }).status === 503);
});
test("admin pagination stays live, preserves totals/currency and emits no phone data", async () => {
  mockOrders([fixture()]);
  const page = await listOrders("previous-cursor");
  assert.equal(page.orders.length, 1);
  assert.equal(page.hasNextPage, true);
  assert.equal(page.endCursor, "test-cursor");
  assert.equal(page.orders[0]?.currency, "KWD");
  assert.ok(!JSON.stringify(page).includes("50000000"));
});
