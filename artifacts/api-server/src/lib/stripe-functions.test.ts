import assert from "node:assert/strict";
import test from "node:test";
import { safeStripeTestCheckoutUrl } from "./stripe-functions";

test("accepts only secure Stripe test Checkout links", () => {
  assert.equal(
    safeStripeTestCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_example"),
    "https://checkout.stripe.com/c/pay/cs_test_example",
  );
  assert.throws(() => safeStripeTestCheckoutUrl("https://checkout.stripe.com/c/pay/cs_live_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("https://evil.example/c/pay/cs_test_example"));
  assert.throws(() => safeStripeTestCheckoutUrl("http://checkout.stripe.com/c/pay/cs_test_example"));
});
