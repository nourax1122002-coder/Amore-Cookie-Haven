import { assertEquals } from "jsr:@std/assert";
import { deriveFlavorRefundComponentAllocation } from "./flavor-reward-refund-allocation.ts";

Deno.test("derives a full flavor product refund from stored order values", () => {
  assertEquals(deriveFlavorRefundComponentAllocation({
    component: "flavor_product",
    quantity: 2,
    orderQuantity: 2,
    unitPriceFils: 2500,
    productLineAmountMinor: 163,
    deliveryLineAmountMinor: 20,
    previouslyRefundedProductFils: 0,
    previouslyRefundedDeliveryMinor: 0,
  }), { ok: true, amountMinor: 163, productRefundFils: 5000 });
});

Deno.test("allocates partial product refunds in deterministic cents", () => {
  const common = {
    component: "flavor_product" as const,
    orderQuantity: 3,
    unitPriceFils: 2500,
    productLineAmountMinor: 163,
    deliveryLineAmountMinor: 20,
    previouslyRefundedDeliveryMinor: 0,
  };
  const first = deriveFlavorRefundComponentAllocation({
    ...common,
    quantity: 1,
    previouslyRefundedProductFils: 0,
  });
  const remaining = deriveFlavorRefundComponentAllocation({
    ...common,
    quantity: 2,
    previouslyRefundedProductFils: 2500,
  });
  assertEquals(first, { ok: true, amountMinor: 55, productRefundFils: 2500 });
  assertEquals(remaining, { ok: true, amountMinor: 108, productRefundFils: 5000 });
  if (first.ok && remaining.ok) assertEquals(first.amountMinor + remaining.amountMinor, 163);
});

Deno.test("shipping-only refund has zero product allocation", () => {
  assertEquals(deriveFlavorRefundComponentAllocation({
    component: "delivery",
    orderQuantity: 1,
    unitPriceFils: 33000,
    productLineAmountMinor: 10500,
    deliveryLineAmountMinor: 950,
    previouslyRefundedProductFils: 0,
    previouslyRefundedDeliveryMinor: 0,
  }), { ok: true, amountMinor: 950, productRefundFils: 0 });
});

Deno.test("rejects duplicate shipping and product refunds beyond remaining units", () => {
  assertEquals(deriveFlavorRefundComponentAllocation({
    component: "delivery",
    orderQuantity: 1,
    unitPriceFils: 33000,
    productLineAmountMinor: 10500,
    deliveryLineAmountMinor: 950,
    previouslyRefundedProductFils: 0,
    previouslyRefundedDeliveryMinor: 950,
  }), { ok: false, reason: "already_refunded" });
  assertEquals(deriveFlavorRefundComponentAllocation({
    component: "flavor_product",
    quantity: 1,
    orderQuantity: 1,
    unitPriceFils: 33000,
    productLineAmountMinor: 10500,
    deliveryLineAmountMinor: 950,
    previouslyRefundedProductFils: 33000,
    previouslyRefundedDeliveryMinor: 0,
  }), { ok: false, reason: "already_refunded" });
});
