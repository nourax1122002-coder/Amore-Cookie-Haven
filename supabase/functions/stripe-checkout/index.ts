import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  constantTimeEqual,
  hasStripeTestKeys,
  isSafeFils,
  sha256Hex,
} from "../_shared/stripe-domain.ts";

type CheckoutItem = { title: string; quantity: number; unitFils: number };
type CheckoutOrder = {
  id: string;
  token_hash: string;
  payment_provider: string | null;
  payment_status: string;
  fulfillment_status: string;
  stock_status: string;
  currency: string;
  items: CheckoutItem[];
  subtotal_fils: number;
  shipping_fils: number;
  total_fils: number;
  expires_at: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_url: string | null;
};

const responseHeaders = { "content-type": "application/json", "cache-control": "no-store" };

function respond(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function supabaseSecretKey(): string {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const keys = JSON.parse(secretKeysJson) as Record<string, unknown>;
      const key = keys.default;
      if (typeof key === "string") return key;
    } catch {
      return "";
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = supabaseSecretKey();
  if (!url || !key) throw new Error("Supabase server configuration unavailable");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isInternalRequest(req: Request): boolean {
  const expected = supabaseSecretKey();
  const presented = req.headers.get("apikey") ?? "";
  return Boolean(expected && presented && constantTimeEqual(expected, presented));
}

function stripeTestSettings() {
  const keys = {
    secretKey: Deno.env.get("STRIPE_SECRET_KEY")?.trim() ?? "",
    webhookSecret: Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim() ?? "",
  };
  return {
    ready: hasStripeTestKeys(keys),
    keys,
  };
}

function stripeClient(secretKey: string) {
  if (!secretKey.startsWith("sk_test_") || secretKey.startsWith("sk_live_")) {
    throw new Error("Only Stripe test secret keys are accepted");
  }
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

function isSafeOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
      && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function loadAuthorizedOrder(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  orderId: string,
  token: string,
): Promise<CheckoutOrder | null> {
  if (!/^[a-f0-9-]{36}$/.test(orderId) || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { data, error } = await supabase.from("customer_orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !data) return null;
  const order = data as CheckoutOrder;
  const tokenHash = await sha256Hex(token);
  return constantTimeEqual(order.token_hash, tokenHash) ? order : null;
}

function makeLineItems(order: CheckoutOrder): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (order.currency !== "KWD" || !Array.isArray(order.items) || order.items.length === 0
    || !isSafeFils(order.subtotal_fils) || !isSafeFils(order.shipping_fils)
    || !isSafeFils(order.total_fils)) {
    throw new Error("Order totals are invalid");
  }
  let calculatedSubtotal = 0;
  const lines = order.items.map(item => {
    if (typeof item.title !== "string" || !item.title.trim() || !Number.isInteger(item.quantity)
      || item.quantity < 1 || !isSafeFils(item.unitFils) || item.unitFils < 1) {
      throw new Error("Order items are invalid");
    }
    calculatedSubtotal += item.unitFils * item.quantity;
    return {
      quantity: item.quantity,
      price_data: {
        currency: "kwd",
        unit_amount: item.unitFils,
        product_data: { name: item.title.slice(0, 200) },
      },
    };
  });
  if (!Number.isSafeInteger(calculatedSubtotal) || calculatedSubtotal !== order.subtotal_fils
    || calculatedSubtotal + order.shipping_fils !== order.total_fils) {
    throw new Error("Order total does not match its stored items");
  }
  if (order.shipping_fils > 0) {
    lines.push({
      quantity: 1,
      price_data: {
        currency: "kwd",
        unit_amount: order.shipping_fils,
        product_data: { name: "Delivery" },
      },
    });
  }
  return lines;
}

async function createSession(input: Record<string, unknown>) {
  const settings = stripeTestSettings();
  if (!settings.ready) return respond(503, { error: "Stripe Test Mode is not configured." });
  const orderId = input.orderId;
  const token = input.token;
  if (typeof orderId !== "string" || typeof token !== "string" || !isSafeOrigin(input.origin)) {
    return respond(400, { error: "Invalid checkout request." });
  }
  const supabase = getSupabaseAdmin();
  const order = await loadAuthorizedOrder(supabase, orderId, token);
  if (!order) return respond(404, { error: "Order not found." });
  if (order.payment_provider !== "stripe" || order.stock_status !== "reserved"
    || !["creating", "pending"].includes(order.payment_status) || order.fulfillment_status === "cancelled") {
    return respond(409, { error: "This order is not available for Stripe checkout." });
  }

  const stripe = stripeClient(settings.keys.secretKey);
  const existingId = order.stripe_checkout_session_id;
  if (existingId) {
    const existing = await stripe.checkout.sessions.retrieve(existingId);
    if (existing.livemode !== false || existing.mode !== "payment"
      || existing.metadata?.order_id !== order.id || existing.client_reference_id !== order.id
      || existing.currency !== "kwd" || existing.amount_total !== order.total_fils) {
      return respond(409, { error: "Stripe session does not match this test order." });
    }
    if (existing.status === "open" && existing.url) return respond(200, { url: existing.url, mode: "test" });
    if (existing.status === "complete") {
      const result = new URL("/payment/success", input.origin);
      result.searchParams.set("order", order.id);
      result.searchParams.set("token", token);
      result.searchParams.set("provider", "stripe");
      return respond(200, { url: result.toString(), mode: "test" });
    }
    return respond(409, { error: "The Stripe test checkout session has expired." });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const successUrl = new URL("/payment/success", input.origin);
  successUrl.searchParams.set("order", order.id);
  successUrl.searchParams.set("token", token);
  successUrl.searchParams.set("provider", "stripe");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancelUrl = new URL("/payment/cancelled", input.origin);
  cancelUrl.searchParams.set("order", order.id);
  cancelUrl.searchParams.set("token", token);
  cancelUrl.searchParams.set("provider", "stripe");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    currency: "kwd",
    line_items: makeLineItems(order),
    client_reference_id: order.id,
    metadata: { order_id: order.id, payment_mode: "test" },
    payment_intent_data: { metadata: { order_id: order.id, payment_mode: "test" } },
    success_url: successUrl.toString(),
    cancel_url: cancelUrl.toString(),
    expires_at: expiresAt,
    allow_promotion_codes: false,
  }, { idempotencyKey: `amore-stripe-test-${order.id}` });

  if (session.livemode !== false || session.mode !== "payment" || !session.id.startsWith("cs_test_")
    || !session.url || session.currency !== "kwd" || session.amount_total !== order.total_fils
    || session.metadata?.order_id !== order.id || session.client_reference_id !== order.id) {
    throw new Error("Stripe returned a session outside the expected test order");
  }

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  const { error: saveError } = await supabase.from("customer_orders").update({
    payment_provider: "stripe",
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    payment_url: session.url,
    payment_status: "pending",
    expires_at: new Date(expiresAt * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).in("payment_status", ["creating", "pending"]);
  if (saveError) throw new Error("Unable to save Stripe test checkout session");
  return respond(200, { url: session.url, mode: "test" });
}

async function cancelSession(input: Record<string, unknown>) {
  const settings = stripeTestSettings();
  if (!settings.ready) return respond(503, { error: "Stripe Test Mode is not configured." });
  if (typeof input.orderId !== "string" || typeof input.token !== "string") {
    return respond(400, { error: "Invalid cancellation request." });
  }
  const supabase = getSupabaseAdmin();
  const order = await loadAuthorizedOrder(supabase, input.orderId, input.token);
  if (!order || order.payment_provider !== "stripe" || !order.stripe_checkout_session_id) {
    return respond(404, { error: "Order not found." });
  }
  if (["paid", "partially_refunded", "refunded"].includes(order.payment_status)) {
    return respond(200, { status: order.payment_status });
  }
  const stripe = stripeClient(settings.keys.secretKey);
  const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
  if (session.livemode !== false || session.metadata?.order_id !== order.id) {
    return respond(409, { error: "Stripe session does not match this test order." });
  }
  if (session.status === "complete") return respond(200, { status: "pending" });
  if (session.status === "open") await stripe.checkout.sessions.expire(session.id);

  await expireOrder(supabase, order.id, order.stripe_checkout_session_id);
  return respond(200, { status: "cancelled" });
}

export async function expireOrder(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  orderId: string,
  sessionId: string,
) {
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

Deno.serve(async req => {
  if (req.method !== "POST") return respond(405, { error: "POST is required." });
  if (!isInternalRequest(req)) return respond(401, { error: "Unauthorized." });
  try {
    const input = await req.json() as Record<string, unknown>;
    const action = input.action;
    if (action === "availability") {
      const settings = stripeTestSettings();
      let schemaReady = false;
      if (settings.ready) {
        try {
          const supabase = getSupabaseAdmin();
          const [customerOrders, accountOrders] = await Promise.all([
            supabase.from("customer_orders").select(
              "payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_refunded_amount_fils,paid_at",
            ).limit(0),
            supabase.from("orders").select(
              "payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_refunded_amount_fils,paid_at",
            ).limit(0),
          ]);
          schemaReady = !customerOrders.error && !accountOrders.error;
        } catch {
          schemaReady = false;
        }
      }
      return respond(200, {
        stripeTestEnabled: settings.ready && schemaReady,
        mode: "test",
      });
    }
    if (action === "create") return await createSession(input);
    if (action === "cancel") return await cancelSession(input);
    return respond(400, { error: "Unknown Stripe checkout action." });
  } catch {
    return respond(503, { error: "Stripe Test Mode is temporarily unavailable." });
  }
});
