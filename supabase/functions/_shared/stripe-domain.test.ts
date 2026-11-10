import {
  constantTimeEqual,
  hasStripeTestKeys,
  nextPaymentStatus,
  parseShippingFils,
  sha256Hex,
  validStripeEventMode,
} from "./stripe-domain.ts";
import Stripe from "stripe";

Deno.test("only test Stripe API keys are accepted", () => {
  const webhookSecret = "whsec_test_fixture";
  if (!hasStripeTestKeys({
    secretKey: "sk_test_fixture",
    publishableKey: "pk_test_fixture",
    webhookSecret,
  })) throw new Error("Valid test keys were rejected");
  if (hasStripeTestKeys({
    secretKey: "sk_live_fixture",
    publishableKey: "pk_live_fixture",
    webhookSecret,
  })) throw new Error("Live keys were accepted");
  if (hasStripeTestKeys({
    secretKey: "sk_test_fixture",
    publishableKey: "pk_live_fixture",
    webhookSecret,
  })) throw new Error("A live publishable key was accepted");
});

Deno.test("shipping amount accepts only integer fils", () => {
  if (parseShippingFils("1250") !== 1250 || parseShippingFils("0") !== 0) {
    throw new Error("Valid shipping fils were rejected");
  }
  if (parseShippingFils("1.250") !== null || parseShippingFils("-5") !== null || parseShippingFils(undefined) !== null) {
    throw new Error("Invalid shipping fils were accepted");
  }
});

Deno.test("success, cancellation, failure, and refunds preserve payment state rules", () => {
  if (nextPaymentStatus("paid", "pending", 0, 1000) !== "paid") throw new Error("Paid status was not set");
  if (nextPaymentStatus("cancelled", "pending", 0, 1000) !== "cancelled") throw new Error("Cancel status was not set");
  if (nextPaymentStatus("failed", "pending", 0, 1000) !== "failed") throw new Error("Failure status was not set");
  if (nextPaymentStatus("refunded", "paid", 500, 1000) !== "partially_refunded") {
    throw new Error("Partial refund was not recorded");
  }
  if (nextPaymentStatus("refunded", "partially_refunded", 1000, 1000) !== "refunded") {
    throw new Error("Full refund was not recorded");
  }
  if (nextPaymentStatus("failed", "paid", 0, 1000) !== "paid") {
    throw new Error("A late failure downgraded a paid order");
  }
  if (nextPaymentStatus("paid", "refunded", 1000, 1000) !== "refunded") {
    throw new Error("A late success downgraded a refunded order");
  }
});

Deno.test("only livemode false Stripe events are accepted", () => {
  if (!validStripeEventMode(false) || validStripeEventMode(true) || validStripeEventMode(undefined)) {
    throw new Error("Stripe event mode validation failed");
  }
});

Deno.test("order tokens are stored as irreversible hashes", async () => {
  const token = "a".repeat(64);
  const digest = await sha256Hex(token);
  if (digest === token || !constantTimeEqual(digest, digest) || constantTimeEqual(digest, token)) {
    throw new Error("Order token hashing/comparison failed");
  }
});

Deno.test("Stripe test webhook signature is verified from the raw payload", async () => {
  const secret = "whsec_test_fixture_only";
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: "evt_test_fixture",
    object: "event",
    api_version: Stripe.API_VERSION,
    created: timestamp,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "payment_intent.payment_failed",
  });
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = new TextEncoder().encode(`${timestamp}.${payload}`);
  const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const signature = Array.from(signatureBytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const header = `t=${timestamp},v1=${signature}`;
  const stripe = new Stripe("sk_test_local_fixture", { httpClient: Stripe.createFetchHttpClient() });
  const event = await stripe.webhooks.constructEventAsync(
    payload, header, secret, undefined, Stripe.createSubtleCryptoProvider(),
  );
  if (!validStripeEventMode(event.livemode)) throw new Error("A signed test event was rejected");
  let rejected = false;
  try {
    await stripe.webhooks.constructEventAsync(
      payload, header, "whsec_wrong_fixture", undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("A webhook signed with the wrong secret was accepted");
});
