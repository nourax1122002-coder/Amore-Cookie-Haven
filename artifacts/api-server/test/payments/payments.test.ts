import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import type { Request } from "express";
import { deleteCustomerOrders, getCustomerOrder, getCustomerOrderByRequestKey, updateCustomerOrder } from "@workspace/db";
import { StartCheckoutBody } from "@workspace/api-zod";
import {
  moneyToFils, paymentConfiguration, safePaymentUrl, validWebhookSignature, verifyDetails,
  webhookSchema,
} from "../../src/lib/myfatoorah";
import {
  localCheckout, verifyPayment, updateFulfillment, reconcileOrder, orderSummary, localOrderList,
} from "../../src/lib/local-orders";
import { fixture } from "./mocks";
import { checkoutAddress } from "../../src/lib/delivery-address";

const savedIds: string[] = [];
const location = { latitude: 29.3759, longitude: 47.9774 };
const details = (id: string, invoice: string, paymentId = "fixture-payment") => ({
  Invoice: { Id: invoice, Status: "PAID", ExternalIdentifier: id },
  Transaction: { Status: "SUCCESS", PaymentId: paymentId },
  Amount: { BaseCurrency: "KWD", ValueInBaseCurrency: "21.500", PayCurrency: "KWD", ValueInPayCurrency: "21.500" },
});
const response = (data: unknown) => new Response(JSON.stringify({ IsSuccess: true, Data: data }), { status: 200 });
const supabaseFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (process.env.SUPABASE_URL && url.startsWith(process.env.SUPABASE_URL)) {
    return supabaseFetch(input, init);
  }
  assert.ok(url.startsWith("https://api.myfatoorah.com/v3/"), "No real network requests allowed");
  if (url.endsWith("/payment-methods")) return response({ PaymentMethods: [{ ApiName: "KNET", CurrencyIso: "KWD" }, { ApiName: "CARD", CurrencyIso: "KWD" }] });
  if (url.endsWith("/payments") && init?.method === "POST") {
    fixture.invoiceCalls++;
    const body = JSON.parse(String(init.body));
    assert.equal(body.Order.Amount, 21.5);
    assert.equal(body.Order.Currency, "KWD");
    assert.equal(body.NotificationOption, "LINK");
    assert.equal(body.Customer.Email, undefined);
    if (fixture.timeout) throw new Error("Ambiguous network timeout");
    return response({ InvoiceId: `inv-${body.Order.ExternalIdentifier}`, PaymentURL: `https://portal.myfatoorah.com/pay/${body.Order.ExternalIdentifier}` });
  }
  const reference = decodeURIComponent(url.split("/").at(-1)!);
  if (url.includes("/invoices/")) return response(fixture.invoices.get(reference));
  return response(fixture.details.get(reference));
};
beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "production", MYFATOORAH_LIVE_ENABLED: "true", MYFATOORAH_ACCOUNT_APPROVED: "true",
    MYFATOORAH_FEES_APPROVED: "true", MYFATOORAH_DELIVERY_APPROVED: "true",
    MYFATOORAH_API_KEY: "fictional-test-key", MYFATOORAH_WEBHOOK_SECRET: "fictional-signing-key",
    SESSION_SECRET: "fictional-session-secret-for-isolated-tests", PAYMENT_PUBLIC_ORIGIN: "https://checkout.example.invalid",
    MYFATOORAH_SHIPPING_FILS: "1500",
  });
  fixture.available = 11; fixture.reserves = 0; fixture.calls = 0; fixture.invoiceCalls = 0; fixture.timeout = false;
  fixture.lines = [{ merchandise: { id: fixture.products[0]!.variantId }, quantity: 2 }];
  fixture.requests.clear(); fixture.details.clear(); fixture.invoices.clear();
});
after(async () => {
  if (savedIds.length) await deleteCustomerOrders(savedIds);
});
async function begin() {
  const cart = randomUUID();
  const req = { fixtureCart: cart } as unknown as Request;
  const body = StartCheckoutBody.parse({ requestKey: randomUUID(), phone: "50000000",
    address: { area: "Fixture", block: "1", street: "2", house: "3", location } });
  const result = await localCheckout(req, body);
  const id = new URL(result.url).pathname.split("/").at(-1)!;
  savedIds.push(id);
  const order = await getCustomerOrder(id);
  assert.ok(order);
  return { req, body, result, order };
}
test("KWD uses integer fils, not floating-point rounding or client totals", () => {
  assert.equal(moneyToFils("10.001"), 10001);
  assert.equal(moneyToFils(10), 10000);
  for (const amount of ["-1", "1.0001", "NaN", "1e3", "Infinity"]) assert.throws(() => moneyToFils(amount));
});
test("every activation requirement is mandatory; development cannot process live payments", () => {
  assert.equal(paymentConfiguration().ready, true);
  for (const key of ["MYFATOORAH_LIVE_ENABLED", "MYFATOORAH_ACCOUNT_APPROVED", "MYFATOORAH_FEES_APPROVED", "MYFATOORAH_DELIVERY_APPROVED", "MYFATOORAH_API_KEY", "MYFATOORAH_WEBHOOK_SECRET", "MYFATOORAH_SHIPPING_FILS"]) {
    const original = process.env[key]; delete process.env[key];
    assert.equal(paymentConfiguration().ready, false, key); process.env[key] = original;
  }
  process.env.NODE_ENV = "development"; assert.equal(paymentConfiguration().ready, false);
  process.env.NODE_ENV = "production"; process.env.PAYMENT_PUBLIC_ORIGIN = "https://fixture.replit.dev";
  assert.equal(paymentConfiguration().ready, false);
});
test("redirect allowlist rejects sandbox, credentials and lookalike hosts", () => {
  assert.equal(safePaymentUrl("https://portal.myfatoorah.com/pay/1"), "https://portal.myfatoorah.com/pay/1");
  for (const url of ["http://portal.myfatoorah.com", "https://demo.myfatoorah.com", "https://myfatoorah.com.evil.invalid", "https://user:pass@api.myfatoorah.com"]) assert.throws(() => safePaymentUrl(url));
});
test("official V2 HMAC field order, empty nulls and tampering checks", () => {
  const payload = webhookSchema.parse({ Event: { Code: 1, Name: "PAYMENT_STATUS_CHANGED", CountryIsoCode: "KWT" },
    Data: { Invoice: { Id: "1", Status: "PAID", ExternalIdentifier: null }, Transaction: { Status: "SUCCESS", PaymentId: "p1" } } });
  const signature = createHmac("sha256", "secret").update("Invoice.Id=1,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=p1,Invoice.ExternalIdentifier=").digest("base64");
  assert.equal(validWebhookSignature(payload, signature, "secret"), true);
  assert.equal(validWebhookSignature(payload, signature, "wrong"), false);
  payload.Data.Invoice.Id = "2"; assert.equal(validWebhookSignature(payload, signature, "secret"), false);
  assert.equal(validWebhookSignature(payload, "", "secret"), false);
});
test("verification binds invoice, external order, payment ID, amount, currency and final success", () => {
  const order = { id: "order", invoiceId: "invoice", totalFils: 21500 };
  assert.equal(verifyDetails(details("order", "invoice"), order, "fixture-payment"), "paid");
  for (const mutation of [
    (d: any) => { d.Invoice.Id = "other"; }, (d: any) => { d.Invoice.ExternalIdentifier = "other"; },
    (d: any) => { d.Amount.ValueInBaseCurrency = "0.1"; }, (d: any) => { d.Amount.PayCurrency = "USD"; },
    (d: any) => { d.Transaction.PaymentId = "other"; },
  ]) { const d = details("order", "invoice"); mutation(d); assert.throws(() => verifyDetails(d, order, "fixture-payment")); }
  const pending = details("order", "invoice"); pending.Invoice.Status = "PENDING"; pending.Transaction.Status = "AUTHORIZE";
  assert.equal(verifyDetails(pending, order, "fixture-payment"), "pending");
});
test("double-clicks/concurrent tabs share one invoice, one reservation and exact server-calculated total", async () => {
  const a = await begin();
  await Promise.all([localCheckout(a.req, a.body), localCheckout(a.req, { ...a.body, requestKey: randomUUID() })]);
  assert.equal(fixture.invoiceCalls, 1); assert.equal(fixture.reserves, 1); assert.equal(fixture.available, 9);
  assert.equal(a.order.totalFils, 21500); assert.equal(a.order.paymentStatus, "creating");
});
test("duplicate variant rows are aggregated before stock checks; no charge or reserve on excess", async () => {
  fixture.lines = [{ merchandise: { id: fixture.products[0]!.variantId }, quantity: 6 }, { merchandise: { id: fixture.products[0]!.variantId }, quantity: 6 }];
  await assert.rejects(localCheckout({ fixtureCart: randomUUID() } as unknown as Request, StartCheckoutBody.parse({
    requestKey: randomUUID(), phone: "50000000", address: { area: "Fixture", block: "1", street: "2", house: "3", location },
  })));
  assert.equal(fixture.invoiceCalls, 0); assert.equal(fixture.reserves, 0);
});
test("failed/forged payment cannot mark paid; genuine confirmation is monotonic and controls fulfillment", async () => {
  const { order } = await begin();
  await assert.rejects(updateFulfillment(order.id, "preparing"));
  const wrong = details(order.id, order.invoiceId!); wrong.Amount.ValueInBaseCurrency = "1";
  fixture.details.set("fixture-payment", wrong); await assert.rejects(verifyPayment(order.id, "fixture-payment"));
  fixture.details.set("fixture-payment", details(order.id, order.invoiceId!));
  const paid = await verifyPayment(order.id, "fixture-payment"); assert.equal(paid.paymentStatus, "paid");
  const failed = details(order.id, order.invoiceId!); failed.Transaction.Status = "FAILED"; failed.Invoice.Status = "PENDING";
  fixture.details.set("fixture-payment", failed);
  assert.equal((await verifyPayment(order.id, "fixture-payment")).paymentStatus, "paid");
  await updateFulfillment(order.id, "preparing"); await assert.rejects(updateFulfillment(order.id, "delivered"));
  const summary = orderSummary(paid);
  assert.equal("phone" in summary, false); assert.equal("address" in summary, false);
  assert.equal("tokenHash" in summary, false);
});
test("confirmed expired unpaid invoice releases once, never on a browser cancellation alone", async () => {
  const { order } = await begin();
  fixture.invoices.set(order.invoiceId!, { Invoice: { Id: order.invoiceId, Status: "PENDING", ExternalIdentifier: order.id, ExpirationDate: new Date(Date.now()-3600000).toISOString() }, Transactions: [{ PaymentId: "failed", Status: "FAILED" }] });
  await reconcileOrder(order.id); await reconcileOrder(order.id);
  assert.equal(fixture.available, 11); assert.equal(fixture.reserves, 2);
});
test("ambiguous provider POST is never retried as another invoice; held stock stays visible for review", async () => {
  fixture.timeout = true;
  const req = { fixtureCart: randomUUID() } as unknown as Request;
  const body = StartCheckoutBody.parse({ requestKey: randomUUID(), phone: "50000000", address: { area:"Fixture",block:"1",street:"2",house:"3",location } });
  await assert.rejects(localCheckout(req, body));
  const row = await getCustomerOrderByRequestKey(body.requestKey!);
  assert.ok(row); savedIds.push(row.id);
  assert.equal(row.paymentStatus, "review"); assert.equal(row.stockStatus, "reserved");
  await assert.rejects(localCheckout(req, body)); assert.equal(fixture.invoiceCalls, 1);
});
test("new orders require finite, in-range numeric coordinates and retain all address fields", () => {
  const address = { area: " Fixture ", block: "1", street: "2", house: "3", location };
  assert.deepEqual(checkoutAddress(address), { ...address, area: "Fixture" });
  for (const point of [undefined, null, {}, {latitude: 91,longitude: 48}, {latitude:29,longitude:181},
    {latitude:NaN,longitude:48}, {latitude:Infinity,longitude:48}, {latitude:"29.3",longitude:48},
    {latitude:"",longitude:48}, {latitude:29,longitude:null}]) {
    assert.throws(() => checkoutAddress({ ...address, location: point }));
  }
  assert.throws(() => checkoutAddress({ ...address, area: " " }));
  assert.deepEqual(checkoutAddress({...address, location:{latitude:0,longitude:0}}).location, {latitude:0,longitude:0});
});
test("coordinates persist, stay administrative-only, and are part of checkout idempotency", async () => {
  const { order, req, body } = await begin();
  assert.deepEqual(order.address.location, location);
  const list = await localOrderList();
  assert.deepEqual(list.find(row => row.id === order.id)?.address.location, location);
  assert.equal("address" in orderSummary(order), false);
  assert.equal(JSON.stringify(orderSummary(order)).includes("latitude"), false);
  await assert.rejects(localCheckout(req, {...body, address:{...body.address!, location:{...location,latitude:29.4}}}));
  assert.equal(fixture.invoiceCalls, 1);
  // Historical JSON records remain readable without inventing a point.
  const oldAddress = { area: "Fixture", block:"1", street:"2", house:"3" };
  await updateCustomerOrder(order.id, { address: oldAddress });
  assert.equal((await localOrderList()).find(row => row.id===order.id)?.address.location, undefined);
});
