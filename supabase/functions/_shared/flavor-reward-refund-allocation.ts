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
  stripeAmountMinor: "amore_flavor_stripe_amount_minor",
  chargeId: "amore_flavor_charge_id",
  paymentIntentId: "amore_flavor_payment_intent_id",
  allocationSignature: "amore_flavor_allocation_signature",
  productDisputeFils: "amore_flavor_product_dispute_fils",
  disputeStatus: "amore_flavor_dispute_status",
} as const;

export type StripeRefundAllocationInput = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  chargeId: string;
  metadata?: Record<string, string> | null;
};

export type FlavorRefundAllocationResult =
  | {
    status: "allocated";
    cumulativeProductRefundFils: number;
    succeededRefundAmountMinor: number;
    refundIds: string[];
  }
  | {
    status: "needs_review";
    reason:
      | "invalid_order"
      | "missing_refunds"
      | "invalid_refund"
      | "refund_amount_mismatch"
      | "duplicate_refund"
      | "missing_allocation_metadata"
      | "invalid_allocation_metadata"
      | "allocation_order_mismatch"
      | "allocation_amount_mismatch"
      | "invalid_product_refund"
      | "product_refund_exceeds_order"
      | "unsupported_dispute_status"
      | "missing_dispute_metadata";
  };

export type RefundAllocationAttestation = {
  refundId: string;
  chargeId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  productRefundFils: string;
};

export type DisputeAllocationAttestation = {
  disputeId: string;
  chargeId: string;
  paymentIntentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  productDisputeFils: string;
};

function toHex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function signAttestation(payload: string, signingKey: string): Promise<string> {
  if (signingKey.length < 20) throw new Error("Allocation signing key is unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(new Uint8Array(signature));
}

function refundAttestationPayload(value: RefundAllocationAttestation): string {
  return [
    "amore-flavor-refund-v1",
    value.refundId,
    value.chargeId,
    value.orderId,
    value.amountMinor,
    value.currency.toLowerCase(),
    value.productRefundFils,
  ].join("|");
}

function disputeAttestationPayload(value: DisputeAllocationAttestation): string {
  return [
    "amore-flavor-dispute-v1",
    value.disputeId,
    value.chargeId,
    value.paymentIntentId,
    value.orderId,
    value.amountMinor,
    value.currency.toLowerCase(),
    value.productDisputeFils,
  ].join("|");
}

export function createRefundAllocationSignature(
  attestation: RefundAllocationAttestation,
  signingKey: string,
): Promise<string> {
  return signAttestation(refundAttestationPayload(attestation), signingKey);
}

export function createDisputeAllocationSignature(
  attestation: DisputeAllocationAttestation,
  signingKey: string,
): Promise<string> {
  return signAttestation(disputeAttestationPayload(attestation), signingKey);
}

async function validHmac(payload: string, signature: string, signingKey: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(signature) || signingKey.length < 20) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = new Uint8Array(signature.match(/.{2}/g)!.map(value => Number.parseInt(value, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(payload));
}

/**
 * Resolve Refund objects retrieved directly from Stripe on the server.
 *
 * The metadata is treated as an allocation attestation only after the Stripe
 * object has been retrieved by the server. Charge-level totals are never used
 * to infer a product share. A refund not marked succeeded does not enter the
 * product commission calculation.
 */
export async function resolveFlavorRewardRefunds(
  refunds: readonly StripeRefundAllocationInput[],
  orderId: string,
  eligibleProductSalesFils: number,
  expectedCumulativeRefundMinor: number,
  expectedChargeId: string,
  signingKey: string,
): Promise<FlavorRefundAllocationResult> {
  if (!orderId.trim() || !Number.isSafeInteger(eligibleProductSalesFils)
    || eligibleProductSalesFils < 1 || !Number.isSafeInteger(expectedCumulativeRefundMinor)
    || expectedCumulativeRefundMinor < 0 || !expectedChargeId.trim()) {
    return { status: "needs_review", reason: "invalid_order" };
  }
  if (refunds.length === 0) return { status: "needs_review", reason: "missing_refunds" };

  const seen = new Set<string>();
  let cumulativeProductRefundFils = 0;
  let succeededRefundAmountMinor = 0;
  const refundIds: string[] = [];

  for (const refund of refunds) {
    if (!/^re_[A-Za-z0-9]+$/.test(refund.id) || !Number.isSafeInteger(refund.amount)
      || refund.amount < 1 || refund.currency.toLowerCase() !== "usd"
      || !["succeeded", "pending", "failed", "canceled"].includes(refund.status)) {
      return { status: "needs_review", reason: "invalid_refund" };
    }
    if (seen.has(refund.id)) return { status: "needs_review", reason: "duplicate_refund" };
    seen.add(refund.id);
    if (refund.status !== "succeeded") continue;
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
    if (metadata[FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor] !== String(refund.amount)) {
      return { status: "needs_review", reason: "allocation_amount_mismatch" };
    }
    if (refund.chargeId !== expectedChargeId
      || metadata[FLAVOR_REWARD_REFUND_METADATA.chargeId] !== expectedChargeId) {
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
    succeededRefundAmountMinor += refund.amount;
    if (!Number.isSafeInteger(cumulativeProductRefundFils)
      || cumulativeProductRefundFils > eligibleProductSalesFils
      || !Number.isSafeInteger(succeededRefundAmountMinor)) {
      return { status: "needs_review", reason: "product_refund_exceeds_order" };
    }
    const signature = metadata[FLAVOR_REWARD_REFUND_METADATA.allocationSignature] ?? "";
    const attestation = {
      refundId: refund.id,
      chargeId: expectedChargeId,
      orderId,
      amountMinor: refund.amount,
      currency: refund.currency,
      productRefundFils: rawProductRefund,
    };
    if (!await validHmac(refundAttestationPayload(attestation), signature, signingKey)) {
      return { status: "needs_review", reason: "invalid_allocation_metadata" };
    }
  }
  if (succeededRefundAmountMinor !== expectedCumulativeRefundMinor) {
    return { status: "needs_review", reason: "refund_amount_mismatch" };
  }

  return {
    status: "allocated",
    cumulativeProductRefundFils,
    succeededRefundAmountMinor,
    refundIds,
  };
}

export type StripeDisputeAllocationInput = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  chargeId: string;
  paymentIntentId: string;
  metadata?: Record<string, string> | null;
};

export type FlavorDisputeAllocationResult =
  | {
    status: "allocated";
    productDisputedFils: number;
    statusForLedger: "open" | "won" | "lost";
  }
  | {
    status: "needs_review";
    reason:
      | "invalid_dispute"
      | "unsupported_dispute_status"
      | "missing_dispute_metadata"
      | "invalid_allocation_metadata"
      | "allocation_order_mismatch"
      | "allocation_amount_mismatch"
      | "invalid_product_refund"
      | "product_refund_exceeds_order";
  };

export async function resolveFlavorRewardDispute(
  dispute: StripeDisputeAllocationInput,
  orderId: string,
  eligibleProductSalesFils: number,
  expectedChargeId: string,
  expectedPaymentIntentId: string,
  signingKey: string,
): Promise<FlavorDisputeAllocationResult> {
  if (!/^dp_[A-Za-z0-9]+$/.test(dispute.id) || !Number.isSafeInteger(dispute.amount)
    || dispute.amount < 1 || dispute.currency.toLowerCase() !== "usd"
    || !Number.isSafeInteger(eligibleProductSalesFils) || eligibleProductSalesFils < 1) {
    return { status: "needs_review", reason: "invalid_dispute" };
  }
  const statusForLedger: "open" | "won" | "lost" | null =
    dispute.status === "won" || dispute.status === "lost"
    ? dispute.status
    : ["needs_response", "under_review", "warning_needs_response", "warning_under_review"].includes(dispute.status)
    ? "open"
    : null;
  if (!statusForLedger) return { status: "needs_review", reason: "unsupported_dispute_status" };

  const metadata = dispute.metadata;
  if (!metadata
    || metadata[FLAVOR_REWARD_REFUND_METADATA.version] !== "1"
    || metadata[FLAVOR_REWARD_REFUND_METADATA.orderId] === undefined
    || metadata[FLAVOR_REWARD_REFUND_METADATA.productDisputeFils] === undefined
    || metadata[FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor] === undefined
    || metadata[FLAVOR_REWARD_REFUND_METADATA.chargeId] === undefined
    || metadata[FLAVOR_REWARD_REFUND_METADATA.paymentIntentId] === undefined
    || metadata[FLAVOR_REWARD_REFUND_METADATA.allocationSignature] === undefined) {
    return { status: "needs_review", reason: "missing_dispute_metadata" };
  }
  if (metadata[FLAVOR_REWARD_REFUND_METADATA.orderId] !== orderId) {
    return { status: "needs_review", reason: "allocation_order_mismatch" };
  }
  if (metadata[FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor] !== String(dispute.amount)) {
    return { status: "needs_review", reason: "allocation_amount_mismatch" };
  }
  if (dispute.chargeId !== expectedChargeId
    || dispute.paymentIntentId !== expectedPaymentIntentId
    || metadata[FLAVOR_REWARD_REFUND_METADATA.chargeId] !== expectedChargeId
    || metadata[FLAVOR_REWARD_REFUND_METADATA.paymentIntentId] !== expectedPaymentIntentId) {
    return { status: "needs_review", reason: "allocation_order_mismatch" };
  }
  const rawProductDispute = metadata[FLAVOR_REWARD_REFUND_METADATA.productDisputeFils]!;
  if (!/^(0|[1-9][0-9]*)$/.test(rawProductDispute)) {
    return { status: "needs_review", reason: "invalid_product_refund" };
  }
  const productDisputedFils = Number(rawProductDispute);
  if (!Number.isSafeInteger(productDisputedFils) || productDisputedFils > eligibleProductSalesFils) {
    return { status: "needs_review", reason: "product_refund_exceeds_order" };
  }
  const signature = metadata[FLAVOR_REWARD_REFUND_METADATA.allocationSignature] ?? "";
  const attestation = {
    disputeId: dispute.id,
    chargeId: expectedChargeId,
    paymentIntentId: expectedPaymentIntentId,
    orderId,
    amountMinor: dispute.amount,
    currency: dispute.currency,
    productDisputeFils: rawProductDispute,
  };
  if (!await validHmac(disputeAttestationPayload(attestation), signature, signingKey)) {
    return { status: "needs_review", reason: "invalid_allocation_metadata" };
  }
  return { status: "allocated", productDisputedFils, statusForLedger };
}
