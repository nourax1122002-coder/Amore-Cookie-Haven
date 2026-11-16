/**
 * Refund metadata is the only safe bridge from Stripe's charge-level refund
 * amount to a Flavor Rewards product amount. The server refund workflow must
 * write these fields when creating each Refund. Missing metadata is a manual
 * review case, never a reason to infer a product amount from the charge total.
 */
export const FLAVOR_REWARD_REFUND_METADATA = {
  version: "amore_flavor_allocation_version",
  orderId: "amore_flavor_order_id",
  productRefundFils: "amore_flavor_product_refund_fils",
} as const;

export type StripeRefundAllocationInput = {
  id: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string> | null;
};

export type FlavorRefundAllocationResult =
  | {
    status: "allocated";
    cumulativeProductRefundFils: number;
    refundIds: string[];
  }
  | {
    status: "needs_review";
    reason:
      | "invalid_order"
      | "missing_refunds"
      | "invalid_refund"
      | "duplicate_refund"
      | "missing_allocation_metadata"
      | "allocation_order_mismatch"
      | "invalid_product_refund"
      | "product_refund_exceeds_order";
  };

/**
 * Resolve all Stripe Refund objects retrieved server-side for one charge.
 *
 * `product_refund_fils` is the exact KWD product amount allocated when that
 * Refund was created. A shipping-only Refund must explicitly carry "0".
 * Dashboard/manual refunds without this server-written metadata are held for
 * human reconciliation rather than prorated across product and delivery.
 */
export function resolveFlavorRewardRefunds(
  refunds: readonly StripeRefundAllocationInput[],
  orderId: string,
  eligibleProductSalesFils: number,
): FlavorRefundAllocationResult {
  if (!orderId.trim() || !Number.isSafeInteger(eligibleProductSalesFils)
    || eligibleProductSalesFils < 1) {
    return { status: "needs_review", reason: "invalid_order" };
  }
  if (refunds.length === 0) return { status: "needs_review", reason: "missing_refunds" };

  const seen = new Set<string>();
  let cumulativeProductRefundFils = 0;
  const refundIds: string[] = [];

  for (const refund of refunds) {
    if (!/^re_[A-Za-z0-9]+$/.test(refund.id) || !Number.isSafeInteger(refund.amount)
      || refund.amount < 1 || refund.currency.toLowerCase() !== "usd") {
      return { status: "needs_review", reason: "invalid_refund" };
    }
    if (seen.has(refund.id)) return { status: "needs_review", reason: "duplicate_refund" };
    seen.add(refund.id);
    refundIds.push(refund.id);

    const metadata = refund.metadata;
    if (!metadata
      || metadata[FLAVOR_REWARD_REFUND_METADATA.version] !== "1"
      || metadata[FLAVOR_REWARD_REFUND_METADATA.orderId] === undefined
      || metadata[FLAVOR_REWARD_REFUND_METADATA.productRefundFils] === undefined) {
      return { status: "needs_review", reason: "missing_allocation_metadata" };
    }
    if (metadata[FLAVOR_REWARD_REFUND_METADATA.orderId] !== orderId) {
      return { status: "needs_review", reason: "allocation_order_mismatch" };
    }

    const rawProductRefund = metadata[FLAVOR_REWARD_REFUND_METADATA.productRefundFils]!;
    if (!/^(0|[1-9][0-9]*)$/.test(rawProductRefund)) {
      return { status: "needs_review", reason: "invalid_product_refund" };
    }
    const productRefundFils = Number(rawProductRefund);
    if (!Number.isSafeInteger(productRefundFils)) {
      return { status: "needs_review", reason: "invalid_product_refund" };
    }
    cumulativeProductRefundFils += productRefundFils;
    if (!Number.isSafeInteger(cumulativeProductRefundFils)
      || cumulativeProductRefundFils > eligibleProductSalesFils) {
      return { status: "needs_review", reason: "product_refund_exceeds_order" };
    }
  }

  return {
    status: "allocated",
    cumulativeProductRefundFils,
    refundIds,
  };
}
