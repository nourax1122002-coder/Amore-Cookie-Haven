import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const product = {
  id: "kwd-fixture",
  handle: "test-cookie",
  title: "Test Cookie Dough",
  titleAr: "عجينة اختبار",
  description: "Fictional browser-test product.",
  descriptionAr: "منتج تجريبي.",
  price: 2,
  currency: "KWD",
  shopCurrency: "KWD",
  pieces: 12,
  imageUrl: "",
  variantId: "gid://shopify/ProductVariant/987654321",
  available: true,
  stock: 5,
  lowStockThreshold: 1,
  ingredients: "",
  ingredientsAr: "",
};
const cart = {
  lines: [{
    id: "fixture-line",
    variantId: product.variantId,
    handle: product.handle,
    title: product.title,
    quantity: 1,
    price: product.price,
    imageUrl: "",
  }],
  subtotal: 2,
  discount: 0,
  total: 2,
  currency: "KWD",
  checkoutReady: false,
  message: "Payments are disabled in this browser test.",
  discountCodes: [],
};
const store = {
  settings: {
    heroTitleEn: "",
    heroTitleAr: "",
    heroTextEn: "",
    heroTextAr: "",
    aboutEn: "",
    aboutAr: "",
    storageEn: "",
    storageAr: "",
    policiesEn: "",
    policiesAr: "",
    whatsapp: "",
    email: "",
    phone: "",
    hoursEn: "",
    hoursAr: "",
    bakingSteps: [{ titleEn: "", titleAr: "", textEn: "", textAr: "" }],
    checkoutEnabled: false,
    logoImage: "",
    bakerImage: "",
    packageImage: "",
    cookieImage: "",
  },
  checkoutReady: false,
  launchMessage: "Payments are disabled in this browser test.",
  shopCurrency: "KWD",
};
const conversionRates = { USD: 3.22, EUR: 2.89, GBP: 2.41, SAR: 12.08 };
let expectedConversionRates = conversionRates;
const apiRequests = [];
const unexpectedApiRequests = [];
const liveCurrencyApiOrigin = process.env.CURRENCY_LIVE_API_ORIGIN;
let exchangeRequests = 0;
let failExchangeRates = false;
let missingCurrency = null;
let authUser = null;
let server;
let browser;

async function fetchLiveRates() {
  const target = new URL(
    "/v2/rates?base=KWD&quotes=USD,EUR,GBP,SAR",
    liveCurrencyApiOrigin,
  );
  const response = await fetch(target, { headers: { accept: "application/json" } });
  const rows = await response.json();
  if (!response.ok || !Array.isArray(rows)) {
    throw new Error(`Live Frankfurter rates failed with HTTP ${response.status}.`);
  }
  return Object.fromEntries(
    rows.map(row => [row.quote, row.rate]).filter(([code, rate]) =>
      Object.hasOwn(conversionRates, code) && Number.isFinite(rate)),
  );
}

async function mockExchangeRates(page) {
  await page.route("https://api.frankfurter.dev/v2/rates**", async route => {
    exchangeRequests += 1;
    if (failExchangeRates) {
      await route.fulfill({ status: 503, json: { error: "Rates temporarily unavailable." } });
      return;
    }
    if (liveCurrencyApiOrigin && missingCurrency === null) {
      const liveUrl = new URL("/v2/rates?base=KWD&quotes=USD,EUR,GBP,SAR", liveCurrencyApiOrigin);
      const liveResponse = await fetch(liveUrl, { headers: { accept: "application/json" } });
      await route.fulfill({
        status: liveResponse.status,
        contentType: liveResponse.headers.get("content-type") || "application/json",
        body: await liveResponse.text(),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: Object.entries(conversionRates).filter(([quote]) => quote !== missingCurrency).map(([quote, rate]) => ({
        base: "KWD",
        quote,
        rate,
        date: "2026-11-07",
      })),
    });
  });
}

async function findFreePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

function getChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Chromium is required. Install it or set CHROMIUM_PATH to its executable.");
  }
}

async function startVite() {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;
  server = spawn("pnpm", [
    "exec", "vite", "--config", "vite.config.ts",
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], {
    cwd: packageRoot,
    env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const collect = chunk => { output = `${output}${chunk}`.slice(-8000); };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before starting.\n${output}`);
    try {
      const response = await fetch(url);
      if (response.ok) return url;
    } catch { /* Vite is still starting. */ }
    await delay(200);
  }
  throw new Error(`Vite did not become ready.\n${output}`);
}

async function mockApi(page) {
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    apiRequests.push({ method, path });
    let body;

    if (method === "GET" && path === "/api/store") {
      body = store;
    } else if (method === "GET" && path === "/api/auth/session") {
      body = { user: authUser };
    } else if (method === "GET" && path === "/api/assistant/status") {
      body = { enabled: false, dailyLimit: 0, perMinuteLimit: 0 };
    } else if (method === "GET" && path === "/api/products") {
      body = [product];
    } else if (method === "GET" && path === `/api/products/${product.handle}`) {
      body = product;
    } else if (method === "GET" && path === "/api/account/orders") {
      body = [{
        id: "00000000-0000-4000-8000-000000000001",
        number: "TEST-ORDER-1",
        createdAt: "2026-11-11T00:00:00.000Z",
        stage: "confirmed",
        financialStatus: "PENDING",
        fulfillmentStatus: "confirmed",
        items: [{ title: product.title, quantity: 1 }],
        total: 2,
        currency: "KWD",
        hasMoreItems: false,
      }];
    } else if (method === "GET" && path === "/api/account/favorites") {
      body = [{
        productId: product.id,
        product,
        addedAt: "2026-11-11T00:00:00.000Z",
      }];
    } else if (method === "GET" && path === "/api/cart") {
      body = cart;
    } else if (method === "POST" && path === "/api/cart") {
      const requestBody = request.postDataJSON();
      if (requestBody.action !== "add" || requestBody.variantId !== product.variantId || requestBody.quantity !== 1) {
        unexpectedApiRequests.push(`${method} ${path} with body ${JSON.stringify(requestBody)}`);
        await route.fulfill({ status: 400, json: { error: "Unexpected cart mutation." } });
        return;
      }
      body = cart;
    } else if (method === "GET" && path === "/api/payments/availability") {
      body = { enabled: false, stripeTestEnabled: false, shippingFils: 3000, methods: [] };
    } else {
      unexpectedApiRequests.push(`${method} ${path}`);
      await route.fulfill({ status: 501, json: { error: "This endpoint is disabled in the browser test." } });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

function displayAmount(amountKwd, currency) {
  if (currency === "KWD") {
    return `KWD ${new Intl.NumberFormat("en-KW", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amountKwd)}`;
  }
  const rate = expectedConversionRates[currency];
  if (!Number.isFinite(rate)) return displayAmount(amountKwd, "KWD");
  const amount = amountKwd * rate;
  return `${currency} ${new Intl.NumberFormat("en-KW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

async function selectCurrency(page, currency) {
  await page.getByTestId("button-navbar-currency").click();
  await page.getByTestId(`button-select-currency-${currency}`).click();
}

async function run() {
  if (liveCurrencyApiOrigin) expectedConversionRates = await fetchLiveRates();
  const baseUrl = await startVite();
  browser = await chromium.launch({
    headless: true,
    executablePath: getChromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await mockExchangeRates(page);
  await mockApi(page);

  await page.goto(`${baseUrl}/`);
  await page.getByTestId("live-currency-rate-usd").waitFor();
  assert.match(await page.getByTestId("live-currency-rate-usd").innerText(), /1 KWD = .+ USD/);
  await page.getByTestId("live-currency-rate-eur").waitFor();
  await page.getByTestId("live-currency-rate-gbp").waitFor();
  await page.getByTestId("live-currency-rate-sar").waitFor();
  await page.getByTestId("live-currency-rate-usd").getByText(/1 KWD =/).waitFor();

  await page.getByTestId("button-navbar-currency").click();
  await page.getByTestId("link-currency-rate-source").waitFor();
  assert.equal(await page.getByTestId("link-currency-rate-source").innerText(), "Frankfurter V2");
  await page.getByTestId("currency-last-updated").getByText(/2026/).waitFor();
  await page.getByTestId("button-navbar-currency").click();
  const rateRequestBeforeRefresh = exchangeRequests;
  const refreshResponse = page.waitForResponse(response => response.url().includes("/v2/rates?"));
  await page.getByTestId("button-refresh-live-currency-rates").click();
  await refreshResponse;
  assert.equal(exchangeRequests, rateRequestBeforeRefresh + 1, "the live section refresh button requests new V2 rates");

  await page.goto(`${baseUrl}/products`);
  const productPrice = page.getByTestId(`product-price-${product.id}`);
  await productPrice.getByText(displayAmount(2, "KWD"), { exact: true }).waitFor();
  await selectCurrency(page, "USD");
  await productPrice.getByText(displayAmount(2, "USD"), { exact: true }).waitFor();
  await page.getByRole("link", { name: product.title, exact: true }).click();
  await page.getByRole("heading", { name: product.title }).waitFor();

  const detailPrice = page.getByTestId("product-display-price");
  for (const currency of ["USD", "EUR", "GBP", "SAR"]) {
    await selectCurrency(page, currency);
    await detailPrice.getByText(displayAmount(2, currency), { exact: true }).waitFor();
  }
  await page.getByTestId("button-add-product").click();
  await page.waitForURL(/\/checkout$/);
  await page.getByTestId("checkout-total").getByText(displayAmount(5, "SAR"), { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Pay with Stripe Test Mode" }).isDisabled(), true,
    "display currency does not enable checkout or create a payment");
  await page.getByRole("status").filter({ hasText: "Test checkout is not ready yet" }).waitFor();

  await page.getByTestId("link-cart").click();
  await page.getByTestId("cart-total-display-price").getByText(displayAmount(2, "SAR"), { exact: true }).waitFor();
  await page.getByTestId("cart-total-original-kwd").getByText(displayAmount(2, "KWD"), { exact: true }).waitFor();
  await page.getByTestId("cart-line-total-converted").getByText(displayAmount(2, "SAR"), { exact: true }).waitFor();
  await selectCurrency(page, "USD");
  await page.getByTestId("cart-total-display-price").getByText(displayAmount(2, "USD"), { exact: true }).waitFor();
  await page.getByTestId("cart-line-total-converted").getByText(displayAmount(2, "USD"), { exact: true }).waitFor();

  await selectCurrency(page, "SAR");
  await page.goto(`${baseUrl}/checkout`);
  await page.getByTestId("checkout-total").getByText(displayAmount(5, "SAR"), { exact: true }).waitFor();
  await page.getByTestId("checkout-converted-total").getByText(displayAmount(5, "SAR"), { exact: true }).waitFor();
  await page.getByTestId(`checkout-line-total-${cart.lines[0].id}`).getByText(displayAmount(2, "SAR"), { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid="delivery-location-picker"]').count(), 0,
    "address-only checkout remains unchanged");
  for (const field of ["area", "block", "street", "house"]) {
    assert.equal(await page.locator(`input[name="${field}"]`).isVisible(), true,
      `checkout still requires the ${field} address field`);
  }
  await page.getByText(displayAmount(3, "SAR"), { exact: true }).waitFor();
  await page.getByText(displayAmount(3, "KWD"), { exact: true }).waitFor();
  await selectCurrency(page, "USD");
  await page.getByTestId("checkout-total").getByText(displayAmount(5, "USD"), { exact: true }).waitFor();
  await page.getByTestId("checkout-converted-total").getByText(displayAmount(5, "USD"), { exact: true }).waitFor();
  await page.getByText(displayAmount(3, "USD"), { exact: true }).waitFor();
  await selectCurrency(page, "KWD");
  await page.getByTestId("checkout-total").getByText(displayAmount(5, "KWD"), { exact: true }).waitFor();
  await page.getByText(displayAmount(3, "KWD"), { exact: true }).waitFor();
  await selectCurrency(page, "USD");
  await page.getByTestId("checkout-total").getByText(displayAmount(5, "USD"), { exact: true }).waitFor();

  const rateMenuRefreshBefore = exchangeRequests;
  await page.getByTestId("button-navbar-currency").click();
  const menuRefreshResponse = page.waitForResponse(response => response.url().includes("/v2/rates?"));
  await page.getByTestId("button-refresh-currency-rates").click();
  await menuRefreshResponse;
  assert.equal(exchangeRequests, rateMenuRefreshBefore + 1, "the navbar refresh button requests new V2 rates");
  await page.getByTestId("button-navbar-currency").click();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByTestId("button-navbar-currency").isVisible(), true,
    "the compact currency selector stays visible on mobile");
  await page.goto(`${baseUrl}/`);
  const mobileColumns = await page.getByTestId("live-currency-rates").evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  assert.equal(mobileColumns, 2, "live-rate cards use two columns on mobile");
  await page.reload();
  await page.getByTestId(`product-price-${product.id}`).getByText(displayAmount(2, "USD"), { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("amore-display-currency")), "USD",
    "currency selection persists across refresh");

  await page.goto(`${baseUrl}/sign-in`);
  assert.equal(await page.evaluate(() => localStorage.getItem("amore-display-currency")), "USD",
    "the saved choice remains available through sign-in");
  await page.goto(`${baseUrl}/products`);
  await page.getByTestId(`product-price-${product.id}`).getByText(displayAmount(2, "USD"), { exact: true }).waitFor();

  authUser = {
    id: "test-customer",
    email: "customer@example.test",
    displayName: "Test Customer",
  };
  await page.reload();
  await page.goto(`${baseUrl}/my-orders`);
  await page.getByText(displayAmount(2, "USD"), { exact: true }).waitFor();
  await page.getByText(displayAmount(2, "KWD"), { exact: true }).waitFor();
  await page.goto(`${baseUrl}/my-favorites`);
  await page.getByText(displayAmount(2, "USD"), { exact: true }).waitFor();
  await selectCurrency(page, "SAR");
  await page.getByText(displayAmount(2, "SAR"), { exact: true }).waitFor();
  await page.goto(`${baseUrl}/my-orders`);
  await page.getByText(displayAmount(2, "SAR"), { exact: true }).waitFor();

  failExchangeRates = true;
  const offlineContext = await browser.newContext();
  const offlinePage = await offlineContext.newPage();
  await offlinePage.addInitScript(() => localStorage.setItem("amore-display-currency", "EUR"));
  await mockExchangeRates(offlinePage);
  await mockApi(offlinePage);
  await offlinePage.goto(`${baseUrl}/products`);
  await offlinePage.getByTestId(`product-price-${product.id}`).getByText(displayAmount(2, "KWD"), { exact: true }).waitFor();
  await offlinePage.getByTestId("button-navbar-currency").click();
  await offlinePage.getByTestId("currency-rate-status").filter({ hasText: "Live rates are unavailable" }).waitFor();
  await offlineContext.close();

  failExchangeRates = false;
  missingCurrency = "GBP";
  const partialContext = await browser.newContext();
  const partialPage = await partialContext.newPage();
  await partialPage.addInitScript(() => localStorage.setItem("amore-display-currency", "GBP"));
  await mockExchangeRates(partialPage);
  await mockApi(partialPage);
  await partialPage.goto(`${baseUrl}/products`);
  await partialPage.getByTestId(`product-price-${product.id}`).getByText(displayAmount(2, "KWD"), { exact: true }).waitFor();
  await partialPage.getByTestId("button-navbar-currency").click();
  await partialPage.getByTestId("currency-rate-status").filter({ hasText: "This currency pair is unavailable" }).waitFor();
  await partialContext.close();

  assert.equal(apiRequests.filter(request => request.method === "POST" && request.path === "/api/cart").length, 1,
    "the test adds only one fixture item");
  assert.deepEqual(unexpectedApiRequests, [], "the storefront does not request unknown APIs or payment endpoints");
  assert.deepEqual(browserErrors, [], `the browser has no runtime errors: ${JSON.stringify(browserErrors)}`);

  console.log(`Global currency browser test passed (${liveCurrencyApiOrigin ? "live Frankfurter V2 API" : "rate fixtures"}): products, details, favorites, cart, delivery, checkout, order history, persistence, refresh, mobile layout and unavailable-rate fallback.`);
}

try {
  await run();
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => server.once("exit", resolve)),
      delay(3_000),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
