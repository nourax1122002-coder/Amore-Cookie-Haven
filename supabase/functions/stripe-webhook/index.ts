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

async function markRefund(
  supabase: ReturnType<typeof getSupabase>,
  stripe: Stripe,
  chargeId: string,
) {
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
  if (paymentStatus === order.payment_status && order.payment_status !== "partially_refunded") return;
  const { error: updateError } = await supabase.from("customer_orders").update({
    payment_status: paymentStatus,
    stripe_charge_id: charge.id,
    stripe_refunded_amount_minor: charge.amount_refunded,
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).eq("stripe_payment_intent_id", paymentIntentId)
    .in("payment_status", ["paid", "partially_refunded", "refunded"]);
  if (updateError) throw new Error("Unable to save Stripe test refund");
}

async function processEvent(stripe: Stripe, event: Stripe.Event) {
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
      await markRefund(supabase, stripe, charge.id);
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
    await processEvent(stripe, event);
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
