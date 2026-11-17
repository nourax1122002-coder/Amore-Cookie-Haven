import assert from "node:assert/strict";
import test from "node:test";
import { safeStripeTestCheckoutUrl } from "./stripe-functions";

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
