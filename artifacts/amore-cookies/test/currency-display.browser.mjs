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
const conversionAmounts = { USD: 6.44, EUR: 5.78, GBP: 4.82, SAR: 24.16 };
const conversionRequests = [];
const failedCurrencies = new Set();
const apiRequests = [];
const unexpectedApiRequests = [];
let server;
let browser;

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
      body = { user: null };
    } else if (method === "GET" && path === "/api/assistant/status") {
      body = { enabled: false, dailyLimit: 0, perMinuteLimit: 0 };
    } else if (method === "GET" && path === "/api/products") {
      body = [product];
    } else if (method === "GET" && path === `/api/products/${product.handle}`) {
      body = product;
    } else if (method === "GET" && path === "/api/currency-conversion") {
      const currency = url.searchParams.get("currency");
      const amount = Number(url.searchParams.get("amount"));
      conversionRequests.push({ currency, amount });
      if (failedCurrencies.has(currency)) {
        await route.fulfill({ status: 503, json: { error: "Currency conversion is temporarily unavailable." } });
        return;
      }
      if (!Object.hasOwn(conversionAmounts, currency)) {
        unexpectedApiRequests.push(`${method} ${path} with currency=${currency}`);
        await route.fulfill({ status: 400, json: { error: "Unexpected conversion currency." } });
        return;
      }
      body = {
        amount: conversionAmounts[currency],
        currency,
        calculation: currency === "USD" || currency === "GBP" ? "eur_cross_rate" : "direct",
        sources: [{
          name: "Test rate source",
          url: "https://example.invalid/rates",
          date: "2026-11-07",
        }],
        informationalOnly: true,
      };
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
      body = { enabled: false, shippingFils: null, methods: [] };
    } else {
      unexpectedApiRequests.push(`${method} ${path}`);
      await route.fulfill({ status: 501, json: { error: "This endpoint is disabled in the browser test." } });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function run() {
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
  await mockApi(page);

  await page.goto(`${baseUrl}/products`);
  try {
    await page.getByText("KWD 2.000", { exact: true }).waitFor({ timeout: 8_000 });
  } catch (error) {
    throw new Error(`${error.message}\nAPI requests: ${JSON.stringify(apiRequests)}\nBrowser errors: ${JSON.stringify(browserErrors)}\nPage text: ${await page.locator("body").innerText()}`);
  }
  await page.getByRole("link", { name: product.title, exact: true }).click();
  await page.getByRole("heading", { name: product.title }).waitFor();

  const visiblePrice = page.getByTestId("product-display-price");
  for (const [currency, amount] of Object.entries(conversionAmounts)) {
    await page.locator("#product-display-currency").selectOption(currency);
    await assert.doesNotReject(
      visiblePrice.getByText(`${amount.toFixed(2)} ${currency}`, { exact: true }).waitFor(),
      `${currency} conversion should be displayed for the KWD product`,
    );
  }
  const productConversionRequests = conversionRequests.slice();

  await page.getByTestId("button-add-product").click();
  await page.waitForURL(/\/checkout$/);
  await page.getByTestId("checkout-total").getByText("2.000 KWD", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Pay now" }).isDisabled(), true,
    "checkout payment remains disabled");
  await page.getByRole("status").filter({ hasText: "Live payments are not enabled yet" }).waitFor();

  await page.getByTestId("link-cart").click();
  await page.getByTestId("cart-total-summary").getByText("2.000 KWD", { exact: true }).waitFor();
  await page.getByText("2.000 KWD", { exact: true }).first().waitFor();
  const cartCurrency = page.getByTestId("cart-display-currency");
  await cartCurrency.selectOption("USD");
  await page.getByTestId("cart-total-display-price").getByText("6.44 USD", { exact: true }).waitFor();
  await page.getByTestId("cart-line-unit-converted").getByText("6.44 USD", { exact: true }).waitFor();
  await page.getByTestId("cart-line-total-converted").getByText("6.44 USD", { exact: true }).waitFor();
  await page.getByTestId("cart-rate-updated").getByText("2026-11-07", { exact: false }).waitFor();
  await page.getByText("Original amount: 2.000 KWD", { exact: true }).waitFor();
  await cartCurrency.selectOption("SAR");
  await page.getByTestId("cart-total-display-price").getByText("24.16 SAR", { exact: true }).waitFor();
  await page.getByTestId("cart-line-total-converted").getByText("24.16 SAR", { exact: true }).waitFor();
  await cartCurrency.selectOption("KWD");
  await page.getByTestId("cart-total-display-price").getByText("2.000 KWD", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/checkout`);
  await page.getByTestId("checkout-total").getByText("2.000 KWD", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Pay now" }).isDisabled(), true,
    "currency display selection does not enable or change checkout");

  await page.goto(`${baseUrl}/products`);
  await page.getByText("KWD 2.000", { exact: true }).waitFor();

  assert.deepEqual(
    productConversionRequests.map(({ currency, amount }) => [currency, amount]),
    Object.entries(conversionAmounts).map(([currency]) => [currency, 2]),
    "the product selector requests each supported conversion using the KWD catalog price",
  );
  failedCurrencies.add("USD");
  await page.evaluate(() => localStorage.setItem("amore-lang", "ar"));
  await page.goto(`${baseUrl}/cart`);
  await page.getByTestId("cart-total-display-price").getByText("2.000 KWD", { exact: true }).waitFor();
  await page.getByTestId("cart-display-currency").selectOption("USD");
  await page.getByRole("alert").filter({ hasText: "تحويل العملة غير متاح مؤقتاً" }).waitFor();
  await page.getByTestId("cart-total-display-price").getByText("2.000 KWD", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/checkout`);
  await page.getByTestId("checkout-total").getByText("2.000 KWD", { exact: true }).waitFor();

  assert.deepEqual(
    conversionRequests.slice(-1).map(({ currency, amount }) => [currency, amount]),
    [["USD", 2]],
    "a failed cart estimate is handled without using a different or fixed rate",
  );
  assert.equal(apiRequests.filter(request => request.method === "POST" && request.path === "/api/cart").length, 1,
    "the test adds one fixture item to the mocked cart");
  assert.deepEqual(unexpectedApiRequests, [], "no live checkout or payment endpoint is called");

  console.log("Currency browser test passed: product rates and cart USD/SAR estimates display; cart falls back to KWD on API failure; checkout stays KWD and payment stays disabled.");
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
