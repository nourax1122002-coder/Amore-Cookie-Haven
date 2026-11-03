import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import { state, resetDatabase } from "./mocks/db";
import { defaultSettings } from "../../src/lib/store-settings";
import { invalidateCatalog } from "../../src/lib/catalog";

const productId = "gid://shopify/Product/101";
const productInput = {
  title: "Fictional cookie", titleAr: "اختبار", description: "Test only",
  descriptionAr: "اختبار", price: 10, pieces: 12, imageUrl: "/images/test.png",
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
let calls: { query: string; variables: Record<string, any> }[] = [];
let fetchCalls = 0;
let product: Record<string, any> | null = null;
const realFetch = globalThis.fetch;

before(async () => {
  // No request can leave this process. Unexpected URLs/operations fail closed.
  globalThis.fetch = async (url, options) => {
    fetchCalls++;
    const endpoint = String(url);
    if (endpoint.startsWith("https://shopify.example.invalid/api/v2/connection?")) {
      return Response.json({ items: [{ settings: {
        shop_domain: "store.example.invalid", storefront_access_token: "fictional-token",
      } }] });
    }
    assert.ok([
      "https://shopify.example.invalid/api/v2/proxy/admin/api/2026-04/graphql.json",
      "https://store.example.invalid/api/2026-04/graphql.json",
    ].includes(endpoint), `Unexpected network URL: ${endpoint}`);
    const request = JSON.parse(String(options?.body));
    calls.push(request);
    const { query, variables } = request;
    let data: Record<string, unknown>;
    if (/product(Create|Update)\(/.test(query)) {
      product = { ...variables.p };
      data = { [/productCreate\(/.test(query) ? "productCreate" : "productUpdate"]: {
        product: { id: productId }, userErrors: [],
      } };
    } else if (/locations\(first:1\)/.test(query)) {
      data = {
        product: { id: productId, handle: "fictional-cookie", variants: { nodes: [{
          id: "gid://shopify/ProductVariant/102", inventoryItem: { id: "gid://shopify/InventoryItem/103" },
        }] } },
        locations: { nodes: [{ id: "gid://shopify/Location/104" }] },
        publications: { nodes: [{ id: "gid://shopify/Publication/105", name: "Replit" }] },
      };
    } else if (/inventoryItem\(id:/.test(query)) {
      data = { inventoryItem: { inventoryLevel: { id: "level", quantities: [{ quantity: 0 }] } } };
    } else if (/product\(handle:/.test(query)) {
      assert.ok(product, "Product must be saved before reading it back");
      data = { product: {
        id: productId, handle: "fictional-cookie", title: product.title,
        description: productInput.description, featuredImage: null, metafields: product.metafields,
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/102", availableForSale: true,
          quantityAvailable: productInput.stock, price: { amount: "10", currencyCode: "KWD" } }] },
      } };
    } else {
      const operation = query.match(/\b(productVariantsBulkUpdate|inventoryItemUpdate|inventorySetQuantities|publishablePublish)\(/)?.[1];
      assert.ok(operation, `Unexpected Shopify query: ${query}`);
      data = { [operation]: { userErrors: [] } };
    }
    return Response.json({ data });
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
  calls = []; fetchCalls = 0; product = null;
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
  const previous = structuredClone({ settings: state.settings, inquiry: state.inquiry, product });
  const response = await request(target, options);
  assert.equal(response.status, status);
  assert.deepEqual(Object.keys(response.body), ["error"]);
  assert.equal(typeof response.body.error, "string");
  assert.deepEqual(state.calls, [], "Rejected requests must not even access the database");
  assert.equal(fetchCalls, 0, "Rejected requests must not reach Shopify or its connector");
  assert.deepEqual(calls, []);
  assert.deepEqual({ settings: state.settings, inquiry: state.inquiry, product }, previous);
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
        assert.deepEqual(state.calls, []);
        assert.ok(product);
        assert.equal(product.title, productInput.title);
        assert.equal(response.body.id, productId);
        assert.equal(response.body.stock, productInput.stock);
        assert.ok(calls.some(c => c.query.includes("id" in target.body ? "productUpdate(" : "productCreate(")));
        assert.ok(calls.some(c => c.query.includes("inventorySetQuantities(")));
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
