import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import { state, resetDatabase } from "./mocks/db";
import { defaultSettings } from "../../src/lib/store-settings";
import { invalidateCatalog } from "../../src/lib/catalog";

const productId = "00000000-0000-4000-8000-000000000101";
const productInput = {
  title: "Fictional cookie", titleAr: "اختبار", description: "Test only",
  descriptionAr: "اختبار", price: 10, pieces: 12,
  imageUrl: "https://amore-project.supabase.co/storage/v1/object/public/amore-products/test.png",
  stock: 3, lowStockThreshold: 1, ingredients: "Test", ingredientsAr: "اختبار",
};
const targets = [
  { name: "create product", method: "POST", path: "/api/admin/products", body: productInput },
  { name: "edit product", method: "POST", path: "/api/admin/products", body: { ...productInput, id: productId } },
  { name: "save settings", method: "PUT", path: "/api/admin/settings",
    body: { ...defaultSettings, heroTitleEn: "Fictional new title" } },
  { name: "update inquiry", method: "PATCH", path: "/api/admin/inquiries/17", body: { status: "contacted" } },
];
type Target = typeof targets[number];
let server: Server;
let port: number;
let fetchCalls = 0;
const realFetch = globalThis.fetch;

before(async () => {
  // No request can leave this process. Supabase operations use isolated mocks.
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("Unexpected network request in isolated admin tests.");
  };
  const { default: app } = await import("../../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  port = bound.port;
});

beforeEach(() => {
  resetDatabase();
  invalidateCatalog();
  fetchCalls = 0;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

type Options = { user?: string; origin?: string; contentType?: string | null; forwardedHost?: string; raw?: string };
async function request(target: Target, options: Options = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, method: target.method, path: target.path,
      headers: {
        Host: "store.example.invalid",
        ...(options.contentType === null ? {} : { "Content-Type": options.contentType ?? "application/json" }),
        ...(options.user ? { "X-Test-User": options.user } : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.forwardedHost ? { "X-Forwarded-Host": options.forwardedHost } : {}),
      },
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("Test HTTP request timed out")));
    req.on("error", reject);
    req.end(options.raw ?? JSON.stringify(target.body));
  });
}

async function rejected(target: Target, status: number, options: Options) {
  const previous = structuredClone({ settings: state.settings, inquiry: state.inquiry, products: state.products });
  const response = await request(target, options);
  assert.equal(response.status, status);
  assert.deepEqual(Object.keys(response.body), ["error"]);
  assert.equal(typeof response.body.error, "string");
  assert.deepEqual(state.calls, [], "Rejected requests must not even access the database");
  assert.equal(fetchCalls, 0, "Rejected requests must not reach external services");
  assert.deepEqual({ settings: state.settings, inquiry: state.inquiry, products: state.products }, previous);
}

for (const target of targets) {
  for (const [identity, status] of [[undefined, 401], ["visitor", 403], ["unverified-owner", 403]] as const) {
    test(`${target.name}: ${identity ?? "anonymous"} rejected before side effects`, async () => {
      await rejected(target, status, { user: identity, origin: "https://store.example.invalid" });
    });
  }
  for (const origin of ["https://attacker.example.invalid", "null", "not-a-url", "https://store.example.invalid.attacker.invalid"]) {
    test(`${target.name}: rejects Origin ${origin} even for owner`, async () => {
      await rejected(target, 403, { user: "owner", origin });
    });
  }
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test", null]) {
    test(`${target.name}: rejects ${contentType ?? "missing Content-Type"} before writing`, async () => {
      await rejected(target, 415, { user: "owner", contentType, origin: "https://store.example.invalid" });
    });
  }
  test(`${target.name}: proxy host rejects external Origin`, async () => {
    await rejected(target, 403, { user: "owner", origin: "https://attacker.example.invalid",
      forwardedHost: "public.example.invalid, internal.example.invalid" });
  });
  test(`${target.name}: malformed JSON rejected before writing`, async () => {
    await rejected(target, 400, { user: "owner", raw: "{" });
  });
  for (const options of [
    { origin: "https://store.example.invalid" },
    {}, // Same-origin non-browser clients are allowed to omit Origin.
    { origin: "https://public.example.invalid", forwardedHost: "public.example.invalid, internal.example.invalid" },
  ]) {
    test(`${target.name}: verified owner can write with ${options.origin ?? "no Origin"}`, async () => {
      const response = await request(target, { user: "owner", ...options });
      assert.equal(response.status, 200);
      if (target.method === "PUT") {
        assert.deepEqual(state.calls, ["insert"]);
        assert.deepEqual(state.settings, target.body);
        assert.deepEqual(response.body, target.body);
        assert.equal(fetchCalls, 0);
      } else if (target.method === "PATCH") {
        assert.deepEqual(state.calls, ["update"]);
        assert.equal(state.inquiry.status, "contacted");
        assert.equal(response.body.id, 17);
        assert.equal(response.body.status, "contacted");
        assert.equal(fetchCalls, 0);
      } else {
        assert.ok(state.calls.includes("saveProduct"));
        const savedProduct = state.products.find(item => item.id === response.body.id);
        assert.ok(savedProduct);
        assert.equal(savedProduct.title, productInput.title);
        assert.equal(response.body.stock, productInput.stock);
        assert.equal(response.body.currency, "KWD");
        assert.equal(fetchCalls, 0);
      }
    });
  }
}

test("empty admin allowlist denies a verified owner before writes", async () => {
  const original = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = "";
    for (const target of targets) await rejected(target, 403, { user: "owner" });
  } finally { process.env.ADMIN_EMAILS = original; }
});
