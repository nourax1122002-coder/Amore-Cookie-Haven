import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  hasStripeTestKeys,
  isSafeFils,
  nextPaymentStatus,
  validStripeEventMode,
} from "../_shared/stripe-domain.ts";

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
  const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY")?.trim() ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim() ?? "";
  return { ready: hasStripeTestKeys({ secretKey, publishableKey, webhookSecret }), secretKey, webhookSecret };
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
    .in("payment_status", ["creating", "pending", "failed"])
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

async function markPaymentFailed(
  supabase: ReturnType<typeof getSupabase>,
  orderId: string,
  sessionId: string,
) {
  const { error } = await supabase.from("customer_orders").update({
    payment_status: "failed",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId).eq("stripe_checkout_session_id", sessionId)
    .in("payment_status", ["creating", "pending"]);
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
  if (session.livemode !== false || session.id !== order.stripe_checkout_session_id
    || session.status !== "complete" || session.payment_status !== "paid"
    || session.currency !== "kwd" || session.amount_total !== order.total_fils
    || session.client_reference_id !== order.id || session.metadata?.order_id !== order.id
    || !paymentIntentId || order.currency !== "KWD" || order.payment_provider !== "stripe") {
    throw new Error("Stripe test payment does not match the saved order");
  }
  if (["refunded", "partially_refunded"].includes(order.payment_status)) return;
  const nextFulfillment = order.stock_status === "reserved" ? "confirmed" : "review";
  const { error } = await supabase.from("customer_orders").update({
    payment_status: "paid",
    fulfillment_status: nextFulfillment,
    stripe_payment_intent_id: paymentIntentId,
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).eq("stripe_checkout_session_id", session.id)
    .in("payment_status", ["creating", "pending", "failed"]);
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
  if (charge.livemode !== false || charge.currency !== "kwd" || !paymentIntentId
    || !isSafeFils(charge.amount_refunded)) {
    throw new Error("Invalid Stripe test refund event");
  }
  const { data, error } = await supabase.from("customer_orders").select("*")
    .eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
  if (error || !data) throw new Error("Stripe refund has no matching order");
  const order = data as WebhookOrder;
  if (order.payment_provider !== "stripe" || order.currency !== "KWD"
    || charge.amount !== order.total_fils || charge.amount_refunded > order.total_fils) {
    throw new Error("Stripe test refund does not match the saved order");
  }
  const paymentStatus = nextPaymentStatus(
    "refunded", order.payment_status, charge.amount_refunded, order.total_fils,
  );
  if (paymentStatus === order.payment_status && order.payment_status !== "partially_refunded") return;
  const { error: updateError } = await supabase.from("customer_orders").update({
    payment_status: paymentStatus,
    stripe_charge_id: charge.id,
    stripe_refunded_amount_fils: charge.amount_refunded,
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
      await markPaymentFailed(supabase, session.metadata.order_id, session.id);
      return;
    }
    case "checkout.session.expired": {
      const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id);
      if (session.livemode !== false || !session.metadata?.order_id) throw new Error("Invalid Stripe test session");
      await expireOrder(supabase, session.metadata.order_id, session.id);
      return;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.currency !== "kwd" || !intent.metadata.order_id) throw new Error("Invalid Stripe test payment intent");
      const order = await getOrderById(supabase, intent.metadata.order_id);
      if (!order || order.payment_provider !== "stripe" || intent.amount !== order.total_fils) {
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
  if (!settings.ready || !signature) return respond(503, { error: "Stripe Test Mode is not configured." });
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return respond(400, { error: "Invalid webhook payload." });
  }
  if (rawBody.length > 1_000_000) return respond(413, { error: "Webhook payload is too large." });
  try {
    const stripe = getStripe(settings.secretKey);
    const event = await stripe.webhooks.constructEventAsync(
      rawBody, signature, settings.webhookSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
    if (!validStripeEventMode(event.livemode)) return respond(403, { error: "Live Stripe events are rejected." });
    await processEvent(stripe, event);
    return respond(200, { received: true, mode: "test" });
  } catch {
    return respond(400, { error: "Stripe test webhook verification or processing failed." });
  }
});
