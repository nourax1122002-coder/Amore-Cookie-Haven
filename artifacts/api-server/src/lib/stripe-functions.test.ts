import assert from "node:assert/strict";
import test from "node:test";
import { createStripeTestCheckout, safeStripeTestCheckoutUrl } from "./stripe-functions";

test("accepts official secure Stripe test Checkout URL path variants", () => {
  assert.equal(
    safeStripeTestCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_example"),
    "https://checkout.stripe.com/c/pay/cs_test_example",
  );
  const hostedUrl = "https://checkout.stripe.com/g/pay/cs_test_example#stripe-hosted-fragment";
  assert.equal(safeStripeTestCheckoutUrl(hostedUrl), hostedUrl);
});

test("rejects URLs outside the exact Stripe Test Checkout origin and session paths", () => {
  assert.throws(() => safeStripeTestCheckoutUrl("https://checkout.stripe.com/c/pay/cs_live_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://checkout.stripe.com/g/pay/cs_live_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://evil.example/c/pay/cs_test_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("http://checkout.stripe.com/c/pay/cs_test_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://checkout.stripe.com:444/g/pay/cs_test_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://checkout.stripe.com/g/pay/cs_test_example/extra"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://checkout.stripe.com/g/pay/not_a_test_session"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://user@checkout.stripe.com/g/pay/cs_test_example"));
});

test("returns a verified Stripe Test Checkout link from the Supabase function response", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  const originalFetch = globalThis.fetch;
  const checkoutUrl = "https://checkout.stripe.com/g/pay/cs_test_example#stripe-generated-fragment";
  let requestBody: Record<string, unknown> | undefined;

  process.env.SUPABASE_URL = "https://fixture-project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-only-invalid-key";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      checkoutStatus: "open",
      mode: "test",
      url: checkoutUrl,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await createStripeTestCheckout({
      orderId: "fixture-order",
      token: "fictional-order-token",
      origin: "https://store.example.invalid",
      lang: "en",
    });
    assert.deepEqual(result, { url: checkoutUrl, status: "open" });
    assert.equal(requestBody?.action, "create");
    assert.equal(requestBody?.orderId, "fixture-order");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});
