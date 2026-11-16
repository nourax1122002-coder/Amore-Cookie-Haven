import assert from "node:assert/strict";
import test from "node:test";
import {
  FLAVOR_REWARD_REFUND_METADATA,
  resolveFlavorRewardRefunds,
  type StripeRefundAllocationInput,
} from "./flavor-reward-refund-allocation";

function refund(
  id: string,
  productRefundFils: string,
  overrides: Partial<StripeRefundAllocationInput> = {},
): StripeRefundAllocationInput {
  return {
    id,
    amount: 500,
    currency: "usd",
    metadata: {
      [FLAVOR_REWARD_REFUND_METADATA.version]: "1",
      [FLAVOR_REWARD_REFUND_METADATA.orderId]: "order-1",
      [FLAVOR_REWARD_REFUND_METADATA.productRefundFils]: productRefundFils,
    },
    ...overrides,
  };
}

test("shipping-only refunds explicitly allocate zero product fils", () => {
  assert.deepEqual(
    resolveFlavorRewardRefunds([refund("re_shipping", "0")], "order-1", 10_000),
    {
      status: "allocated",
      cumulativeProductRefundFils: 0,
      refundIds: ["re_shipping"],
    },
  );
});

test("product refunds sum exact KWD product allocations, not USD charge amounts", () => {
  const result = resolveFlavorRewardRefunds([
    refund("re_product1", "2500", { amount: 800 }),
    refund("re_shipping", "0", { amount: 300 }),
    refund("re_product2", "1500", { amount: 200 }),
  ], "order-1", 10_000);
  assert.equal(result.status, "allocated");
  if (result.status === "allocated") assert.equal(result.cumulativeProductRefundFils, 4_000);
});

test("refunds without exact server-written allocation metadata require review", () => {
  const result = resolveFlavorRewardRefunds([
    refund("re_dashboard", "0", { metadata: {} }),
  ], "order-1", 10_000);
  assert.deepEqual(result, { status: "needs_review", reason: "missing_allocation_metadata" });
});

test("allocation metadata cannot be applied to a different order", () => {
  assert.deepEqual(
    resolveFlavorRewardRefunds([refund("re_other", "100")], "order-2", 10_000),
    { status: "needs_review", reason: "allocation_order_mismatch" },
  );
});

test("malformed or excessive product allocation fails closed", () => {
  assert.deepEqual(
    resolveFlavorRewardRefunds([refund("re_bad", "-1")], "order-1", 10_000),
    { status: "needs_review", reason: "invalid_product_refund" },
  );
  assert.deepEqual(
    resolveFlavorRewardRefunds([refund("re_large", "10001")], "order-1", 10_000),
    { status: "needs_review", reason: "product_refund_exceeds_order" },
  );
});
