import assert from "node:assert/strict";
import test from "node:test";
import {
  createDisputeAllocationSignature,
  createRefundAllocationSignature,
  FLAVOR_REWARD_REFUND_METADATA,
  resolveFlavorRewardDispute,
  resolveFlavorRewardRefunds,
  type StripeDisputeAllocationInput,
  type StripeRefundAllocationInput,
} from "./flavor-reward-refund-allocation.ts";

const TEST_SIGNING_KEY = "sk_test_local_flavor_rewards_attestation_key";
const ORDER_ID = "order-1";
const CHARGE_ID = "ch_case1";
const PAYMENT_INTENT_ID = "pi_case1";

async function refund(
  id: string,
  productRefundFils: string,
  options: {
    amount?: number;
    status?: string;
    orderId?: string;
    chargeId?: string;
    omitSignature?: boolean;
    metadataOverride?: Record<string, string>;
  } = {},
): Promise<StripeRefundAllocationInput> {
  const amount = options.amount ?? 500;
  const orderId = options.orderId ?? ORDER_ID;
  const chargeId = options.chargeId ?? CHARGE_ID;
  const attestation = {
    refundId: id,
    chargeId,
    orderId,
    amountMinor: amount,
    currency: "usd",
    productRefundFils,
  };
  const signature = options.omitSignature
    ? ""
    : await createRefundAllocationSignature(attestation, TEST_SIGNING_KEY);
  return {
    id,
    amount,
    currency: "usd",
    status: options.status ?? "succeeded",
    chargeId,
    metadata: {
      [FLAVOR_REWARD_REFUND_METADATA.version]: "1",
      [FLAVOR_REWARD_REFUND_METADATA.orderId]: orderId,
      [FLAVOR_REWARD_REFUND_METADATA.productRefundFils]: productRefundFils,
      [FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor]: String(amount),
      [FLAVOR_REWARD_REFUND_METADATA.chargeId]: chargeId,
      [FLAVOR_REWARD_REFUND_METADATA.allocationSignature]: signature,
      ...options.metadataOverride,
    },
  };
}

test("shipping-only refund explicitly allocates zero product fils", async () => {
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_shipping", "0")],
      ORDER_ID,
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    {
      status: "allocated",
      cumulativeProductRefundFils: 0,
      succeededRefundAmountMinor: 500,
      refundIds: ["re_shipping"],
    },
  );
});

test("product refunds sum signed exact KWD product allocations, not USD amounts", async () => {
  const refunds = await Promise.all([
    refund("re_product1", "2500", { amount: 800 }),
    refund("re_shipping", "0", { amount: 300 }),
    refund("re_product2", "1500", { amount: 200 }),
  ]);
  const result = await resolveFlavorRewardRefunds(
    refunds,
    ORDER_ID,
    10_000,
    1_300,
    CHARGE_ID,
    TEST_SIGNING_KEY,
  );
  assert.equal(result.status, "allocated");
  if (result.status === "allocated") {
    assert.equal(result.cumulativeProductRefundFils, 4_000);
    assert.equal(result.succeededRefundAmountMinor, 1_300);
  }
});

test("refund metadata without a server signature requires review", async () => {
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_dashboard", "0", { omitSignature: true })],
      ORDER_ID,
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "invalid_allocation_metadata" },
  );
});

test("allocation is bound to the exact Stripe order and charge", async () => {
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_other", "100")],
      "order-2",
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "allocation_order_mismatch" },
  );
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_charge", "100")],
      ORDER_ID,
      10_000,
      500,
      "ch_other",
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "allocation_order_mismatch" },
  );
});

test("refund totals reconcile and pending refunds do not adjust commission", async () => {
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_tampered", "100")],
      ORDER_ID,
      10_000,
      600,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "refund_amount_mismatch" },
  );
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_pending", "100", { status: "pending" })],
      ORDER_ID,
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "refund_amount_mismatch" },
  );
});

test("malformed and excessive product allocations fail closed", async () => {
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_bad", "-1")],
      ORDER_ID,
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "invalid_product_refund" },
  );
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_large", "10001")],
      ORDER_ID,
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "product_refund_exceeds_order" },
  );
  assert.deepEqual(
    await resolveFlavorRewardRefunds(
      [await refund("re_forged", "100", { metadataOverride: { amore_flavor_product_refund_fils: "9999" } })],
      ORDER_ID,
      10_000,
      500,
      CHARGE_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "invalid_allocation_metadata" },
  );
});

async function dispute(
  status: string,
  productDisputedFils: string,
  options: {
    orderId?: string;
    chargeId?: string;
    paymentIntentId?: string;
    metadataOverride?: Record<string, string>;
    omitSignature?: boolean;
  } = {},
): Promise<StripeDisputeAllocationInput> {
  const orderId = options.orderId ?? ORDER_ID;
  const chargeId = options.chargeId ?? CHARGE_ID;
  const paymentIntentId = options.paymentIntentId ?? PAYMENT_INTENT_ID;
  const attestation = {
    disputeId: "dp_case1",
    chargeId,
    paymentIntentId,
    orderId,
    amountMinor: 500,
    currency: "usd",
    productDisputeFils: productDisputedFils,
  };
  const signature = options.omitSignature
    ? ""
    : await createDisputeAllocationSignature(attestation, TEST_SIGNING_KEY);
  return {
    id: "dp_case1",
    amount: 500,
    currency: "usd",
    status,
    chargeId,
    paymentIntentId,
    metadata: {
      [FLAVOR_REWARD_REFUND_METADATA.version]: "1",
      [FLAVOR_REWARD_REFUND_METADATA.orderId]: orderId,
      [FLAVOR_REWARD_REFUND_METADATA.productDisputeFils]: productDisputedFils,
      [FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor]: "500",
      [FLAVOR_REWARD_REFUND_METADATA.chargeId]: chargeId,
      [FLAVOR_REWARD_REFUND_METADATA.paymentIntentId]: paymentIntentId,
      [FLAVOR_REWARD_REFUND_METADATA.allocationSignature]: signature,
      [FLAVOR_REWARD_REFUND_METADATA.disputeStatus]: status,
      ...options.metadataOverride,
    },
  };
}

test("shipping-only and product disputes affect only exact product fils", async () => {
  assert.deepEqual(
    await resolveFlavorRewardDispute(
      await dispute("needs_response", "0"),
      ORDER_ID,
      10_000,
      CHARGE_ID,
      PAYMENT_INTENT_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "allocated", productDisputedFils: 0, statusForLedger: "open" },
  );
  assert.deepEqual(
    await resolveFlavorRewardDispute(
      await dispute("lost", "1200"),
      ORDER_ID,
      10_000,
      CHARGE_ID,
      PAYMENT_INTENT_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "allocated", productDisputedFils: 1200, statusForLedger: "lost" },
  );
});

test("ambiguous dispute metadata, signatures, and statuses require review", async () => {
  assert.deepEqual(
    await resolveFlavorRewardDispute(
      await dispute("under_review", "100", { omitSignature: true }),
      ORDER_ID,
      10_000,
      CHARGE_ID,
      PAYMENT_INTENT_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "invalid_allocation_metadata" },
  );
  assert.deepEqual(
    await resolveFlavorRewardDispute(
      await dispute("warning_closed", "100"),
      ORDER_ID,
      10_000,
      CHARGE_ID,
      PAYMENT_INTENT_ID,
      TEST_SIGNING_KEY,
    ),
    { status: "needs_review", reason: "unsupported_dispute_status" },
  );
});
