import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  hasStripeTestKeys,
  nextPaymentStatus,
  validStripeEventMode,
} from "../_shared/stripe-domain.ts";
import {
  convertKwdFilsToUsdMinor,
  KWD_USD_RATE_SOURCE,
} from "../_shared/kwd-usd-settlement.ts";
import {
  createDisputeAllocationSignature,
  FLAVOR_REWARD_REFUND_METADATA,
  resolveFlavorRewardDispute,
  resolveFlavorRewardRefunds,
  type StripeRefundAllocationInput,
} from "../_shared/flavor-reward-refund-allocation.ts";

const headers = { "content-type": "application/json", "cache-control": "no-store" };
type WebhookOrder = {
  id: string;
  payment_provider: string | null;
  payment_status: string;
  fulfillment_status: string;
  stock_status: string;
  currency: string;
  total_fils: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_payment_currency: string | null;
  stripe_payment_amount_minor: number | string | null;
  stripe_exchange_rate: number | string | null;
  stripe_exchange_rate_source: string | null;
  stripe_exchange_rate_updated_at: string | null;
  stripe_refunded_amount_minor: number | string;
};

function respond(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function supabaseSecretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, unknown>;
      if (typeof keys.default === "string") return keys.default;
    } catch {
      return "";
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function stripeSettings() {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim() ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim() ?? "";
  return { ready: hasStripeTestKeys({ secretKey, webhookSecret }), secretKey, webhookSecret };
}

function getStripe(secretKey: string) {
  if (!secretKey.startsWith("sk_test_") || secretKey.startsWith("sk_live_")) {
    throw new Error("Only Stripe test keys are accepted");
  }
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = supabaseSecretKey();
  if (!url || !key) throw new Error("Supabase server configuration unavailable");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function expireOrder(supabase: ReturnType<typeof getSupabase>, orderId: string, sessionId: string) {
  const { data, error } = await supabase.from("customer_orders").update({
    payment_status: "cancelled",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId).eq("stripe_checkout_session_id", sessionId)
    .in("payment_status", ["creating", "pending", "failed", "review"])
    .select("stock_status").maybeSingle();
  if (error) throw new Error("Unable to save canceled Stripe test payment");
  let stockStatus = data?.stock_status;
  if (!data) {
    const { data: current, error: readError } = await supabase.from("customer_orders")
      .select("payment_status,stock_status").eq("id", orderId)
      .eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (readError) throw new Error("Unable to check canceled Stripe test order");
    if (current?.payment_status === "cancelled") stockStatus = current.stock_status;
  }
  if (stockStatus === "reserved") {
    const { error: releaseError } = await supabase.rpc("release_order_stock", { p_order_id: orderId });
    if (releaseError) throw new Error("Unable to release canceled Stripe test order stock");
  }
}

async function getOrderById(supabase: ReturnType<typeof getSupabase>, id: string) {
  const { data, error } = await supabase.from("customer_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load payment order");
  return data as WebhookOrder | null;
}

function safeUsdMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000_000;
}

function safeWebhookError(error: unknown) {
  const details = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const message = error instanceof Error ? error.message : "Unknown webhook error";
  return {
    type: typeof details.type === "string" ? details.type.slice(0, 80) : "Error",
    code: typeof details.code === "string" ? details.code.slice(0, 80) : null,
    statusCode: typeof details.statusCode === "number" ? details.statusCode : null,
    message: message
      .replace(/\b(?:sk_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)\b/g, "[redacted]")
      .slice(0, 240),
  };
}

function storedUsdAmount(order: WebhookOrder): number | null {
  const value = typeof order.stripe_payment_amount_minor === "number"
    ? order.stripe_payment_amount_minor
    : Number(order.stripe_payment_amount_minor);
  return safeUsdMinor(value) && value > 0 ? value : null;
}

function storedExchangeRate(order: WebhookOrder): number | null {
  const value = typeof order.stripe_exchange_rate === "number"
    ? order.stripe_exchange_rate
    : Number(order.stripe_exchange_rate);
  return Number.isFinite(value) && value >= 0.1 && value <= 10 ? value : null;
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftMillis = Date.parse(left);
  const rightMillis = Date.parse(right);
  return Number.isFinite(leftMillis) && Number.isFinite(rightMillis) && leftMillis === rightMillis;
}

function hasValidUsdSettlement(order: WebhookOrder): boolean {
  const amount = storedUsdAmount(order);
  const rate = storedExchangeRate(order);
  const updatedAt = order.stripe_exchange_rate_updated_at
    ? Date.parse(order.stripe_exchange_rate_updated_at)
    : Number.NaN;
  const rateAge = Date.now() - updatedAt;
  try {
    return order.currency === "KWD" && order.stripe_payment_currency === "USD"
      && amount !== null && rate !== null
      && order.stripe_exchange_rate_source === KWD_USD_RATE_SOURCE
      && Number.isFinite(updatedAt) && rateAge >= -5 * 60_000 && rateAge <= 48 * 60 * 60 * 1000
      && convertKwdFilsToUsdMinor(order.total_fils, rate) === amount;
  } catch {
    return false;
  }
}

function validSessionMetadata(session: Stripe.Checkout.Session, order: WebhookOrder): boolean {
  const rate = storedExchangeRate(order);
  return rate !== null && session.metadata?.order_id === order.id
    && session.metadata.original_currency === "KWD"
    && session.metadata.original_total_fils === String(order.total_fils)
    && session.metadata.stripe_payment_currency === "USD"
    && session.metadata.stripe_payment_amount_minor === String(storedUsdAmount(order))
    && session.metadata.exchange_rate === rate.toFixed(10)
    && session.metadata.exchange_rate_source === KWD_USD_RATE_SOURCE
    && sameTimestamp(session.metadata.exchange_rate_updated_at, order.stripe_exchange_rate_updated_at);
}

async function markPaymentFailed(
  supabase: ReturnType<typeof getSupabase>,
  orderId: string,
  sessionId: string,
) {
  const { error } = await supabase.from("customer_orders").update({
    payment_status: "failed",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId).eq("stripe_checkout_session_id", sessionId)
    .in("payment_status", ["creating", "pending", "review"]);
  if (error) throw new Error("Unable to save failed Stripe test payment");
}

async function markPaymentPaid(
  supabase: ReturnType<typeof getSupabase>,
  order: WebhookOrder,
  session: Stripe.Checkout.Session,
) {
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  const checks = {
    testMode: session.livemode === false,
    sessionId: session.id === order.stripe_checkout_session_id,
    sessionComplete: session.status === "complete",
    paymentConfirmed: session.payment_status === "paid",
    currencyUsd: session.currency === "usd",
    amountMatches: session.amount_total === storedUsdAmount(order),
    orderReferenceMatches: session.client_reference_id === order.id,
    metadataMatches: validSessionMetadata(session, order),
    settlementMatches: hasValidUsdSettlement(order),
    paymentIntentPresent: Boolean(paymentIntentId),
    providerStripe: order.payment_provider === "stripe",
  };
  if (Object.values(checks).some(matches => !matches)) {
    console.error("stripe_paid_order_validation_failed", checks);
    throw new Error("Stripe test payment does not match the saved order");
  }
  if (["refunded", "partially_refunded"].includes(order.payment_status)) return;
  const nextFulfillment = order.stock_status === "reserved" ? "confirmed" : "review";
  const { error } = await supabase.from("customer_orders").update({
    payment_status: "paid",
    fulfillment_status: nextFulfillment,
    stripe_payment_intent_id: paymentIntentId,
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).eq("stripe_checkout_session_id", session.id)
    .in("payment_status", ["creating", "pending", "failed", "review"]);
  if (error) throw new Error("Unable to save successful Stripe test payment");
}

type FlavorRewardSnapshot = {
  customer_order_id: string;
  eligible_sales_fils: number;
};

async function getFlavorRewardSnapshot(
  supabase: ReturnType<typeof getSupabase>,
  orderId: string,
): Promise<FlavorRewardSnapshot | null> {
  const { data, error } = await supabase.from("flavor_reward_order_snapshots")
    .select("customer_order_id,eligible_sales_fils")
    .eq("customer_order_id", orderId)
    .maybeSingle();
  if (error) {
    // Keep ordinary Amore orders working if the approved Flavor Rewards
    // migration has not yet been applied. No reward is processed in that case.
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new Error("Unable to load Flavor Rewards order snapshot");
  }
  return data as FlavorRewardSnapshot | null;
}

async function processFlavorPaidOrder(
  supabase: ReturnType<typeof getSupabase>,
  event: Stripe.Event,
  order: WebhookOrder,
  session: Stripe.Checkout.Session,
) {
  if (!await getFlavorRewardSnapshot(supabase, order.id)) return;
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;
  if (!paymentIntentId || !safeUsdMinor(session.amount_total) || session.amount_total < 1) {
    throw new Error("Verified Flavor Rewards payment is missing Stripe amounts");
  }
  const { error } = await supabase.rpc("process_flavor_reward_stripe_event", {
    p_stripe_event_id: event.id,
    p_event_type: event.type,
    p_customer_order_id: order.id,
    p_checkout_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_livemode: event.livemode,
    p_payment_status: session.payment_status,
    p_payment_amount_minor: session.amount_total,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
  });
  if (error) throw new Error("Unable to record verified Flavor Rewards payment");
}

function sanitizedRefundAllocations(refunds: readonly StripeRefundAllocationInput[]) {
  const value = (refund: StripeRefundAllocationInput, key: string, maxLength = 64) => {
    const raw = refund.metadata?.[key];
    return typeof raw === "string" ? raw.slice(0, maxLength) : null;
  };
  return {
    refundCount: refunds.length,
    omittedRefundCount: Math.max(0, refunds.length - 10),
    refunds: refunds.slice(0, 10).map(refund => ({
      id: refund.id.slice(0, 64),
      amount: refund.amount,
      currency: refund.currency.slice(0, 3),
      status: refund.status.slice(0, 16),
      allocationVersion: value(refund, FLAVOR_REWARD_REFUND_METADATA.version, 8),
      orderId: value(refund, FLAVOR_REWARD_REFUND_METADATA.orderId),
      productRefundFils: value(refund, FLAVOR_REWARD_REFUND_METADATA.productRefundFils, 20),
      stripeAmountMinor: value(refund, FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor, 20),
      chargeId: value(refund, FLAVOR_REWARD_REFUND_METADATA.chargeId),
      hasAllocationSignature: Boolean(value(
        refund,
        FLAVOR_REWARD_REFUND_METADATA.allocationSignature,
        64,
      )),
    })),
  };
}

async function queueFlavorRewardReview(
  supabase: ReturnType<typeof getSupabase>,
  event: Stripe.Event,
  order: WebhookOrder,
  objectType: "charge" | "dispute",
  objectId: string,
  amountMinor: number,
  reasonCode: string,
  allocationMetadata: Record<string, unknown>,
) {
  const paymentIntentId = order.stripe_payment_intent_id;
  if (!paymentIntentId || !safeUsdMinor(amountMinor) || amountMinor < 1) {
    throw new Error("Review event is missing verified Stripe order references");
  }
  const { error } = await supabase.rpc("record_flavor_reward_review_event", {
    p_stripe_event_id: event.id,
    p_event_type: event.type,
    p_stripe_object_type: objectType,
    p_stripe_object_id: objectId,
    p_customer_order_id: order.id,
    p_payment_intent_id: paymentIntentId,
    p_amount_minor: amountMinor,
    p_currency: "usd",
    p_reason_code: reasonCode,
    p_allocation_metadata: allocationMetadata,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
  });
  if (error) throw new Error("Unable to save Flavor Rewards payment review event");
}

async function stripeRefundsForCharge(
  stripe: Stripe,
  chargeId: string,
): Promise<{ refunds: StripeRefundAllocationInput[]; complete: boolean }> {
  const refunds: StripeRefundAllocationInput[] = [];
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await stripe.refunds.list({
      charge: chargeId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    refunds.push(...page.data.map((refund: Stripe.Refund) => ({
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status ?? "",
      chargeId,
      metadata: refund.metadata,
    })));
    if (!page.has_more) return { refunds, complete: true };
    const lastId = page.data.at(-1)?.id;
    if (!lastId) return { refunds, complete: false };
    startingAfter = lastId;
  }
  return { refunds, complete: false };
}

async function markRefund(
  supabase: ReturnType<typeof getSupabase>,
  stripe: Stripe,
  chargeId: string,
): Promise<{ order: WebhookOrder; charge: Stripe.Charge }> {
  const charge = await stripe.charges.retrieve(chargeId);
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (charge.livemode !== false || charge.currency !== "usd" || !paymentIntentId
    || !safeUsdMinor(charge.amount_refunded) || charge.amount_refunded < 1) {
    throw new Error("Invalid Stripe test refund event");
  }
  const { data, error } = await supabase.from("customer_orders").select("*")
    .eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
  if (error || !data) throw new Error("Stripe refund has no matching order");
  const order = data as WebhookOrder;
  const paymentAmount = storedUsdAmount(order);
  if (order.payment_provider !== "stripe" || !hasValidUsdSettlement(order)
    || charge.amount !== paymentAmount || charge.amount_refunded > paymentAmount!) {
    throw new Error("Stripe test refund does not match the saved order");
  }
  const paymentStatus = nextPaymentStatus(
    "refunded", order.payment_status, charge.amount_refunded, paymentAmount!,
  );
  const { error: updateError } = await supabase.from("customer_orders").update({
    payment_status: paymentStatus,
    stripe_charge_id: charge.id,
    stripe_refunded_amount_minor: charge.amount_refunded,
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).eq("stripe_payment_intent_id", paymentIntentId)
    .in("payment_status", ["paid", "partially_refunded", "refunded"]);
  if (updateError) throw new Error("Unable to save Stripe test refund");
  return { order, charge };
}

function refundReviewReason(reason: string): string {
  switch (reason) {
    case "missing_allocation_metadata":
    case "allocation_order_mismatch":
    case "allocation_amount_mismatch":
    case "refund_amount_mismatch":
    case "invalid_refund":
    case "duplicate_refund":
    case "invalid_product_refund":
    case "product_refund_exceeds_order":
      return reason;
    case "missing_refunds":
      return "refund_list_incomplete";
    default:
      return "invalid_allocation_metadata";
  }
}

async function processFlavorRefund(
  supabase: ReturnType<typeof getSupabase>,
  stripe: Stripe,
  event: Stripe.Event,
  order: WebhookOrder,
  charge: Stripe.Charge,
  signingKey: string,
) {
  const snapshot = await getFlavorRewardSnapshot(supabase, order.id);
  if (!snapshot) return;
  const { refunds, complete } = await stripeRefundsForCharge(stripe, charge.id);
  const metadata = sanitizedRefundAllocations(refunds);
  if (!complete) {
    await queueFlavorRewardReview(
      supabase,
      event,
      order,
      "charge",
      charge.id,
      charge.amount_refunded,
      "refund_list_incomplete",
      metadata,
    );
    return;
  }
  const allocation = await resolveFlavorRewardRefunds(
    refunds,
    order.id,
    snapshot.eligible_sales_fils,
    charge.amount_refunded,
    charge.id,
    signingKey,
  );
  if (allocation.status === "needs_review") {
    await queueFlavorRewardReview(
      supabase,
      event,
      order,
      "charge",
      charge.id,
      charge.amount_refunded,
      refundReviewReason(allocation.reason),
      metadata,
    );
    return;
  }
  const paymentIntentId = order.stripe_payment_intent_id;
  const sessionId = order.stripe_checkout_session_id;
  if (!paymentIntentId || !sessionId) throw new Error("Flavor Rewards refund is missing saved payment references");
  const { error } = await supabase.rpc("process_flavor_reward_stripe_event", {
    p_stripe_event_id: event.id,
    p_event_type: event.type,
    p_customer_order_id: order.id,
    p_checkout_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
    p_livemode: event.livemode,
    p_payment_amount_minor: charge.amount,
    p_refunded_amount_minor: charge.amount_refunded,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
    p_product_refunded_fils: allocation.cumulativeProductRefundFils,
  });
  if (error) throw new Error("Unable to record verified Flavor Rewards refund");
}

async function processFlavorDispute(
  supabase: ReturnType<typeof getSupabase>,
  stripe: Stripe,
  event: Stripe.Event,
  eventDispute: Stripe.Dispute,
  signingKey: string,
) {
  let dispute = await stripe.disputes.retrieve(eventDispute.id);
  if (dispute.livemode !== false || dispute.currency !== "usd" || !safeUsdMinor(dispute.amount)
    || dispute.amount < 1) {
    throw new Error("Invalid Stripe Test Mode dispute");
  }
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) throw new Error("Stripe dispute is missing its charge reference");
  const charge = await stripe.charges.retrieve(chargeId);
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (charge.livemode !== false || charge.currency !== "usd" || !paymentIntentId) {
    throw new Error("Stripe dispute charge is not a valid test payment");
  }
  const { data, error } = await supabase.from("customer_orders").select("*")
    .eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
  if (error || !data) throw new Error("Stripe dispute has no matching order");
  const order = data as WebhookOrder;
  if (order.payment_provider !== "stripe" || !hasValidUsdSettlement(order)
    || charge.amount !== storedUsdAmount(order) || dispute.amount > charge.amount
    || dispute.payment_intent && (
      (typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent.id)
        !== paymentIntentId
    )) {
    throw new Error("Stripe dispute does not match the saved test order");
  }
  const snapshot = await getFlavorRewardSnapshot(supabase, order.id);
  if (!snapshot) return;
  const originalDisputeMetadata = { ...(dispute.metadata ?? {}) };
  const hasAnyFlavorAllocation = [
    FLAVOR_REWARD_REFUND_METADATA.version,
    FLAVOR_REWARD_REFUND_METADATA.orderId,
    FLAVOR_REWARD_REFUND_METADATA.productDisputeFils,
    FLAVOR_REWARD_REFUND_METADATA.allocationSignature,
  ].some(key => originalDisputeMetadata[key] !== undefined);
  const allocationMetadataMatchesOrder =
    originalDisputeMetadata[FLAVOR_REWARD_REFUND_METADATA.version] === "1"
    && originalDisputeMetadata[FLAVOR_REWARD_REFUND_METADATA.orderId] === order.id
    && originalDisputeMetadata[FLAVOR_REWARD_REFUND_METADATA.chargeId] === charge.id
    && originalDisputeMetadata[FLAVOR_REWARD_REFUND_METADATA.paymentIntentId] === paymentIntentId
    && originalDisputeMetadata[FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor] === String(dispute.amount)
    && originalDisputeMetadata[FLAVOR_REWARD_REFUND_METADATA.productDisputeFils]
      === String(snapshot.eligible_sales_fils);
  if (dispute.amount === charge.amount && charge.amount === storedUsdAmount(order)
    && (!hasAnyFlavorAllocation || allocationMetadataMatchesOrder)) {
    // A full-charge dispute has an exact product component from the saved
    // one-line order snapshot; shipping is excluded rather than prorated.
    // Partial disputes remain ambiguous and are sent to the review queue.
    try {
      const signature = await createDisputeAllocationSignature({
        disputeId: dispute.id,
        chargeId: charge.id,
        paymentIntentId,
        orderId: order.id,
        amountMinor: dispute.amount,
        currency: dispute.currency,
        productDisputeFils: String(snapshot.eligible_sales_fils),
      }, signingKey);
      dispute = await stripe.disputes.update(dispute.id, {
        metadata: {
          ...originalDisputeMetadata,
          [FLAVOR_REWARD_REFUND_METADATA.version]: "1",
          [FLAVOR_REWARD_REFUND_METADATA.orderId]: order.id,
          [FLAVOR_REWARD_REFUND_METADATA.productDisputeFils]: String(snapshot.eligible_sales_fils),
          [FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor]: String(dispute.amount),
          [FLAVOR_REWARD_REFUND_METADATA.chargeId]: charge.id,
          [FLAVOR_REWARD_REFUND_METADATA.paymentIntentId]: paymentIntentId,
          [FLAVOR_REWARD_REFUND_METADATA.allocationSignature]: signature,
          [FLAVOR_REWARD_REFUND_METADATA.disputeStatus]: dispute.status,
        },
      });
    } catch {
      await queueFlavorRewardReview(
        supabase,
        event,
        order,
        "dispute",
        dispute.id,
        dispute.amount,
        "missing_dispute_metadata",
        { disputeId: dispute.id, amount: dispute.amount, currency: dispute.currency, status: dispute.status },
      );
      return;
    }
  }
  const disputeMetadata = dispute.metadata ?? {};
  const reviewMetadataValue = (key: string, maxLength = 64) => {
    const value = disputeMetadata[key];
    return typeof value === "string" ? value.slice(0, maxLength) : null;
  };
  const allocation = await resolveFlavorRewardDispute({
    id: dispute.id,
    amount: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    chargeId,
    paymentIntentId,
    metadata: disputeMetadata,
  }, order.id, snapshot.eligible_sales_fils, charge.id, paymentIntentId, signingKey);
  if (allocation.status === "needs_review") {
    await queueFlavorRewardReview(
      supabase,
      event,
      order,
      "dispute",
      dispute.id,
      dispute.amount,
      allocation.reason === "allocation_order_mismatch"
        ? "allocation_order_mismatch"
        : allocation.reason === "allocation_amount_mismatch"
        ? "allocation_amount_mismatch"
        : allocation.reason === "unsupported_dispute_status"
        ? "unsupported_dispute_status"
        : allocation.reason === "missing_dispute_metadata"
        ? "missing_dispute_metadata"
        : allocation.reason === "product_refund_exceeds_order"
        ? "product_refund_exceeds_order"
        : allocation.reason === "invalid_product_refund"
        ? "invalid_product_refund"
        : "invalid_dispute",
      {
        disputeId: dispute.id,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        allocationVersion: reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.version, 8),
        orderId: reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.orderId),
        productDisputeFils:
          reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.productDisputeFils, 20),
        stripeAmountMinor:
          reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.stripeAmountMinor, 20),
        chargeId: reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.chargeId),
        paymentIntentId:
          reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.paymentIntentId),
        hasAllocationSignature: Boolean(
          reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.allocationSignature, 64),
        ),
        declaredStatus:
          reviewMetadataValue(FLAVOR_REWARD_REFUND_METADATA.disputeStatus, 32),
      },
    );
    return;
  }
  const sessionId = order.stripe_checkout_session_id;
  if (!sessionId) throw new Error("Flavor Rewards dispute is missing its saved Checkout Session");
  const { error: processingError } = await supabase.rpc("process_flavor_reward_stripe_event", {
    p_stripe_event_id: event.id,
    p_event_type: event.type,
    p_customer_order_id: order.id,
    p_checkout_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
    p_livemode: event.livemode,
    p_payment_amount_minor: charge.amount,
    p_dispute_id: dispute.id,
    p_dispute_amount_minor: dispute.amount,
    p_dispute_status: allocation.statusForLedger,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
    p_dispute_product_amount_fils: allocation.productDisputedFils,
  });
  if (processingError) throw new Error("Unable to record verified Flavor Rewards dispute");
}

async function processEvent(stripe: Stripe, event: Stripe.Event, signingKey: string) {
  if (!validStripeEventMode(event.livemode)) throw new Error("Live Stripe events are rejected");
  const supabase = getSupabase();
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const eventSession = event.data.object as Stripe.Checkout.Session;
      const session = await stripe.checkout.sessions.retrieve(eventSession.id);
      if (session.livemode !== false) throw new Error("Live Stripe sessions are rejected");
      const orderId = session.metadata?.order_id;
      if (!orderId) throw new Error("Stripe test session is missing the order reference");
      const order = await getOrderById(supabase, orderId);
      if (!order) throw new Error("Stripe test session order does not exist");
      await markPaymentPaid(supabase, order, session);
      await processFlavorPaidOrder(supabase, event, order, session);
      return;
    }
    case "checkout.session.async_payment_failed": {
      const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id);
      if (session.livemode !== false || !session.metadata?.order_id) throw new Error("Invalid Stripe test session");
      const order = await getOrderById(supabase, session.metadata.order_id);
      if (!order || session.currency !== "usd" || session.amount_total !== storedUsdAmount(order)
        || !hasValidUsdSettlement(order) || !validSessionMetadata(session, order)) {
        throw new Error("Failed Stripe test session does not match the saved order");
      }
      await markPaymentFailed(supabase, order.id, session.id);
      return;
    }
    case "checkout.session.expired": {
      const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id);
      if (session.livemode !== false || !session.metadata?.order_id) throw new Error("Invalid Stripe test session");
      const order = await getOrderById(supabase, session.metadata.order_id);
      if (!order || session.id !== order.stripe_checkout_session_id || session.currency !== "usd"
        || session.amount_total !== storedUsdAmount(order) || !hasValidUsdSettlement(order)
        || !validSessionMetadata(session, order)) {
        throw new Error("Expired Stripe test session does not match the saved order");
      }
      await expireOrder(supabase, order.id, session.id);
      return;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.currency !== "usd" || !intent.metadata.order_id) throw new Error("Invalid Stripe test payment intent");
      const order = await getOrderById(supabase, intent.metadata.order_id);
      if (!order || order.payment_provider !== "stripe" || !hasValidUsdSettlement(order)
        || intent.amount !== storedUsdAmount(order)
        || intent.metadata.original_currency !== "KWD"
        || intent.metadata.original_total_fils !== String(order.total_fils)
        || intent.metadata.stripe_payment_currency !== "USD"
        || intent.metadata.stripe_payment_amount_minor !== String(storedUsdAmount(order))
        || intent.metadata.exchange_rate_source !== KWD_USD_RATE_SOURCE
        || intent.metadata.exchange_rate !== storedExchangeRate(order)?.toFixed(10)
        || !sameTimestamp(intent.metadata.exchange_rate_updated_at, order.stripe_exchange_rate_updated_at)) {
        throw new Error("Stripe test payment intent does not match the saved order");
      }
      const { error } = await supabase.from("customer_orders").update({
        payment_status: "failed",
        stripe_payment_intent_id: intent.id,
        updated_at: new Date().toISOString(),
      }).eq("id", intent.metadata.order_id).eq("payment_provider", "stripe")
        .in("payment_status", ["creating", "pending"]);
      if (error) throw new Error("Unable to save failed Stripe test payment");
      return;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const result = await markRefund(supabase, stripe, charge.id);
      await processFlavorRefund(
        supabase,
        stripe,
        event,
        result.order,
        result.charge,
        signingKey,
      );
      return;
    }
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      await processFlavorDispute(
        supabase,
        stripe,
        event,
        event.data.object as Stripe.Dispute,
        signingKey,
      );
      return;
    }
    default:
      return;
  }
}

Deno.serve(async req => {
  if (req.method !== "POST") return respond(405, { error: "POST is required." });
  const signature = req.headers.get("stripe-signature");
  const settings = stripeSettings();
  if (!settings.ready) {
    console.error("stripe_webhook_test_configuration_unavailable");
    return respond(503, { error: "Stripe Test Mode is not configured." });
  }
  if (!signature) return respond(400, { error: "Stripe signature is required." });
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return respond(400, { error: "Invalid webhook payload." });
  }
  if (rawBody.length > 1_000_000) return respond(413, { error: "Webhook payload is too large." });
  const stripe = getStripe(settings.secretKey);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody, signature, settings.webhookSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("stripe_webhook_signature_rejected", safeWebhookError(error));
    return respond(400, { error: "Stripe test webhook signature is invalid." });
  }
  if (!validStripeEventMode(event.livemode)) return respond(403, { error: "Live Stripe events are rejected." });
  try {
    await processEvent(stripe, event, settings.secretKey);
    return respond(200, { received: true, mode: "test" });
  } catch (error) {
    console.error("stripe_webhook_processing_failed", {
      eventId: event.id,
      eventType: event.type,
      ...safeWebhookError(error),
    });
    return respond(500, { error: "Stripe test webhook processing failed." });
  }
});
