import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  constantTimeEqual,
  hasStripeTestKeys,
  isSafeFils,
  sha256Hex,
} from "../_shared/stripe-domain.ts";
import {
  allocateUsdLineAmounts,
  convertKwdFilsToUsdMinor,
  KWD_USD_RATE_SOURCE,
  kwdUsdRateProvider,
} from "../_shared/kwd-usd-settlement.ts";

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
  stripe_payment_currency: string | null;
  stripe_payment_amount_minor: number | string | null;
  stripe_exchange_rate: number | string | null;
  stripe_exchange_rate_source: string | null;
  stripe_exchange_rate_updated_at: string | null;
  payment_url: string | null;
};

const responseHeaders = { "content-type": "application/json", "cache-control": "no-store" };

function respond(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function safeStripeError(error: unknown) {
  const detail = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const message = error instanceof Error ? error.message : "Stripe API request failed";
  return {
    type: typeof detail.type === "string" ? detail.type.slice(0, 80) : "Error",
    code: typeof detail.code === "string" ? detail.code.slice(0, 80) : null,
    statusCode: typeof detail.statusCode === "number" ? detail.statusCode : null,
    requestId: typeof detail.requestId === "string" ? detail.requestId.slice(0, 100) : null,
    message: message
      .replace(/\b(?:sk_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)\b/g, "[redacted]")
      .slice(0, 300),
  };
}

function stripeResponseMeta(response: unknown) {
  const value = typeof response === "object" && response !== null
    ? response as Record<string, unknown>
    : {};
  const lastResponse = typeof value.lastResponse === "object" && value.lastResponse !== null
    ? value.lastResponse as Record<string, unknown>
    : {};
  return {
    statusCode: typeof lastResponse.statusCode === "number" ? lastResponse.statusCode : null,
    requestId: typeof lastResponse.requestId === "string" ? lastResponse.requestId.slice(0, 100) : null,
  };
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

function makeUsdLineItems(
  order: CheckoutOrder,
  rate: number,
  lang: "ar" | "en",
): { lines: Stripe.Checkout.SessionCreateParams.LineItem[]; totalMinor: number } {
  if (order.currency !== "KWD" || !Array.isArray(order.items) || order.items.length === 0
    || !isSafeFils(order.subtotal_fils) || !isSafeFils(order.shipping_fils)
    || !isSafeFils(order.total_fils)) {
    throw new Error("Order totals are invalid");
  }
  let calculatedSubtotal = 0;
  const components = order.items.map(item => {
    if (typeof item.title !== "string" || !item.title.trim() || !Number.isInteger(item.quantity)
      || item.quantity < 1 || !isSafeFils(item.unitFils) || item.unitFils < 1) {
      throw new Error("Order items are invalid");
    }
    calculatedSubtotal += item.unitFils * item.quantity;
    return {
      name: `${item.title.slice(0, 160)} (${item.quantity} ${item.quantity === 1 ? "bag" : "bags"})`,
      amountFils: item.unitFils * item.quantity,
    };
  });
  if (!Number.isSafeInteger(calculatedSubtotal) || calculatedSubtotal !== order.subtotal_fils
    || calculatedSubtotal + order.shipping_fils !== order.total_fils) {
    throw new Error("Order total does not match its stored items");
  }
  if (order.shipping_fils > 0) components.push({
    name: lang === "ar" ? "التوصيل" : "Delivery",
    amountFils: order.shipping_fils,
  });
  const allocation = allocateUsdLineAmounts(components, order.total_fils, rate);
  const rateLabel = rate.toFixed(6);
  const sourceDate = new Date(order.stripe_exchange_rate_updated_at ?? Date.now()).toISOString().slice(0, 10);
  const description = lang === "ar"
    ? `الإجمالي الأصلي ${formatKwd(order.total_fils)} د.ك؛ 1 د.ك = ${rateLabel} USD؛ المصدر ${KWD_USD_RATE_SOURCE} (${sourceDate}).`
    : `Original total KWD ${formatKwd(order.total_fils)}; 1 KWD = USD ${rateLabel}; ${KWD_USD_RATE_SOURCE} (${sourceDate}).`;
  return {
    totalMinor: allocation.totalMinor,
    lines: allocation.lines.map((line, index) => ({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: line.amountMinor,
        product_data: {
          name: line.name,
          ...(index === 0 ? { description } : {}),
        },
      },
    })),
  };
}

function formatKwd(totalFils: number): string {
  return (totalFils / 1000).toFixed(3);
}

function parseStoredRate(value: number | string | null): number | null {
  if (value === null) return null;
  const rate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(rate) ? rate : null;
}

function validStoredSettlement(order: CheckoutOrder) {
  const rate = parseStoredRate(order.stripe_exchange_rate);
  const amountMinor = order.stripe_payment_amount_minor === null
    ? null
    : typeof order.stripe_payment_amount_minor === "number"
    ? order.stripe_payment_amount_minor
    : Number(order.stripe_payment_amount_minor);
  const updatedAt = order.stripe_exchange_rate_updated_at
    ? Date.parse(order.stripe_exchange_rate_updated_at)
    : Number.NaN;
  const age = Date.now() - updatedAt;
  const fieldsPresent = order.stripe_payment_currency === "USD"
    && Number.isSafeInteger(amountMinor) && amountMinor !== null && amountMinor > 0
    && typeof order.stripe_exchange_rate_source === "string"
    && order.stripe_exchange_rate_source === KWD_USD_RATE_SOURCE
    && rate !== null && rate >= 0.1 && rate <= 10
    && Number.isFinite(updatedAt) && age >= -5 * 60_000 && age <= 48 * 60 * 60 * 1000;
  if (!fieldsPresent) return null;
  try {
    if (convertKwdFilsToUsdMinor(order.total_fils, rate) !== amountMinor) return null;
  } catch {
    return null;
  }
  return { rate, updatedAt: new Date(updatedAt).toISOString(), amountMinor };
}

async function persistSettlement(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  order: CheckoutOrder,
  rate: number,
  updatedAt: string,
  amountMinor: number,
): Promise<{ rate: number; updatedAt: string; amountMinor: number }> {
  const { data, error } = await supabase.from("customer_orders").update({
    stripe_payment_currency: "USD",
    stripe_payment_amount_minor: amountMinor,
    stripe_exchange_rate: rate,
    stripe_exchange_rate_source: KWD_USD_RATE_SOURCE,
    stripe_exchange_rate_updated_at: updatedAt,
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).is("stripe_checkout_session_id", null)
    .is("stripe_payment_amount_minor", null)
    .in("payment_status", ["creating", "pending"])
    .select("stripe_payment_currency,stripe_payment_amount_minor,stripe_exchange_rate,stripe_exchange_rate_source,stripe_exchange_rate_updated_at")
    .maybeSingle();
  if (error) throw new Error("Unable to save the USD test settlement.");
  let saved = data;
  if (!saved) {
    const result = await supabase.from("customer_orders")
      .select("stripe_payment_currency,stripe_payment_amount_minor,stripe_exchange_rate,stripe_exchange_rate_source,stripe_exchange_rate_updated_at")
      .eq("id", order.id).maybeSingle();
    if (result.error) throw new Error("Unable to read the saved USD test settlement.");
    saved = result.data;
  }
  const savedAmount = typeof saved?.stripe_payment_amount_minor === "number"
    ? saved.stripe_payment_amount_minor
    : Number(saved?.stripe_payment_amount_minor);
  const savedRate = parseStoredRate(saved?.stripe_exchange_rate ?? null);
  const savedUpdatedAt = typeof saved?.stripe_exchange_rate_updated_at === "string"
    ? saved.stripe_exchange_rate_updated_at
    : "";
  const validatedTimestamp = Date.parse(savedUpdatedAt);
  if (!saved || saved.stripe_payment_currency !== "USD" || savedAmount < 1
    || !Number.isSafeInteger(savedAmount) || savedRate === null
    || saved.stripe_exchange_rate_source !== KWD_USD_RATE_SOURCE
    || !Number.isFinite(validatedTimestamp)
    || Date.now() - validatedTimestamp > 48 * 60 * 60 * 1000
    || Date.now() - validatedTimestamp < -5 * 60_000
    || convertKwdFilsToUsdMinor(order.total_fils, savedRate) !== savedAmount) {
    throw new Error("The USD settlement changed during checkout.");
  }
  return { rate: savedRate, updatedAt: new Date(validatedTimestamp).toISOString(), amountMinor: savedAmount };
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
    const settlement = validStoredSettlement(order);
    if (existing.livemode !== false || existing.mode !== "payment"
      || existing.metadata?.order_id !== order.id || existing.client_reference_id !== order.id
      || existing.currency !== "usd" || existing.amount_total !== settlement?.amountMinor
      || !settlement
      || existing.metadata.original_total_fils !== String(order.total_fils)
      || existing.metadata.stripe_payment_amount_minor !== String(settlement.amountMinor)) {
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

  const expiresAt = Math.floor(Date.parse(order.expires_at) / 1000);
  const minimumBufferedExpiry = Math.floor(Date.now() / 1000) + 32 * 60;
  if (!Number.isSafeInteger(expiresAt) || expiresAt < minimumBufferedExpiry) {
    return respond(409, { error: "The reserved order has expired. Do not retry checkout." });
  }
  let settlement = validStoredSettlement(order);
  if (!settlement) {
    const hasPartialSettlement = order.stripe_payment_currency !== null
      || order.stripe_payment_amount_minor !== null
      || order.stripe_exchange_rate !== null
      || order.stripe_exchange_rate_source !== null
      || order.stripe_exchange_rate_updated_at !== null;
    if (hasPartialSettlement) {
      return respond(409, { error: "The saved USD conversion needs review before checkout." });
    }
    let quote;
    try {
      quote = await kwdUsdRateProvider.getRate();
    } catch (error) {
      console.error("stripe_usd_exchange_rate_unavailable", {
        message: error instanceof Error ? error.message.slice(0, 160) : "Rate provider failed",
      });
      return respond(503, { error: "usd_exchange_rate_unavailable" });
    }
    const amountMinor = convertKwdFilsToUsdMinor(order.total_fils, quote.rate);
    settlement = await persistSettlement(supabase, order, quote.rate, quote.updatedAt, amountMinor);
  }
  const lang = input.lang === "ar" ? "ar" : "en";
  // Use the persisted rate timestamp for the hosted checkout description.
  order.stripe_exchange_rate_updated_at = settlement.updatedAt;
  const usdLineItems = makeUsdLineItems(order, settlement.rate, lang);
  if (usdLineItems.totalMinor !== settlement.amountMinor) {
    return respond(409, { error: "The converted amount does not match the saved order." });
  }
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
    currency: "usd",
    branding_settings: {
      display_name: "Amore Cookies",
      background_color: "#FFFAF8",
      button_color: "#5B0D1E",
    },
    // Keep Stripe's account-configured dynamic methods, including eligible card wallets.
    line_items: usdLineItems.lines,
    client_reference_id: order.id,
    metadata: {
      order_id: order.id,
      payment_mode: "test",
      original_currency: "KWD",
      original_total_fils: String(order.total_fils),
      stripe_payment_currency: "USD",
      stripe_payment_amount_minor: String(settlement.amountMinor),
      exchange_rate: settlement.rate.toFixed(10),
      exchange_rate_source: KWD_USD_RATE_SOURCE,
      exchange_rate_updated_at: settlement.updatedAt,
    },
    payment_intent_data: {
      metadata: {
        order_id: order.id,
        payment_mode: "test",
        original_currency: "KWD",
        original_total_fils: String(order.total_fils),
        stripe_payment_currency: "USD",
        stripe_payment_amount_minor: String(settlement.amountMinor),
        exchange_rate: settlement.rate.toFixed(10),
        exchange_rate_source: KWD_USD_RATE_SOURCE,
        exchange_rate_updated_at: settlement.updatedAt,
      },
    },
    success_url: successUrl.toString(),
    cancel_url: cancelUrl.toString(),
    expires_at: expiresAt,
    allow_promotion_codes: false,
  }, { idempotencyKey: `amore-stripe-test-${order.id}` });

  if (session.livemode !== false || session.mode !== "payment" || !session.id.startsWith("cs_test_")
    || !session.url || session.currency !== "usd" || session.amount_total !== settlement.amountMinor
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
    stripe_payment_currency: "USD",
    stripe_payment_amount_minor: settlement.amountMinor,
    stripe_exchange_rate: settlement.rate,
    stripe_exchange_rate_source: KWD_USD_RATE_SOURCE,
    stripe_exchange_rate_updated_at: settlement.updatedAt,
    payment_url: session.url,
    payment_status: "pending",
    expires_at: new Date(expiresAt * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).in("payment_status", ["creating", "pending"]);
  if (saveError) throw new Error("Unable to save Stripe test checkout session");
  return respond(200, { url: session.url, mode: "test" });
}

async function diagnoseStripe(input: Record<string, unknown>) {
  const settings = stripeTestSettings();
  if (!settings.ready) return respond(200, { ready: false, reason: "test_secrets_not_configured" });

  const orderId = input.orderId;
  const createdAt = input.createdAt;
  if (typeof orderId !== "string" || !/^[a-f0-9-]{36}$/.test(orderId) || typeof createdAt !== "string") {
    return respond(200, { ready: false, reason: "invalid_diagnostic_request" });
  }
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return respond(200, { ready: false, reason: "invalid_order_timestamp" });
  }

  const stripe = stripeClient(settings.keys.secretKey);
  let apiCheck: Record<string, unknown>;
  try {
    const balance = await stripe.balance.retrieve();
    apiCheck = {
      ok: true,
      ...stripeResponseMeta(balance),
    };
  } catch (error) {
    const details = safeStripeError(error);
    console.error("stripe_test_api_diagnostic_failed", details);
    apiCheck = { ok: false, error: details };
  }

  let sessionCheck: Record<string, unknown>;
  try {
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: Math.floor(createdAtMs / 1000) - 60 },
    });
    const matches = sessions.data.filter(session =>
      session.client_reference_id === orderId || session.metadata?.order_id === orderId
    );
    sessionCheck = {
      ok: true,
      count: matches.length,
      sessions: matches.map(session => ({
        id: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        mode: session.mode,
        livemode: session.livemode,
        amountTotal: session.amount_total,
        currency: session.currency,
        paymentIntentId: typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      })),
      hasMore: sessions.has_more,
    };
  } catch (error) {
    const details = safeStripeError(error);
    console.error("stripe_test_session_lookup_failed", details);
    sessionCheck = { ok: false, error: details };
  }

  let paymentIntentCheck: Record<string, unknown>;
  try {
    const intents = await stripe.paymentIntents.list({
      limit: 100,
      created: { gte: Math.floor(createdAtMs / 1000) - 60 },
    });
    const matches = intents.data.filter(intent => intent.metadata?.order_id === orderId);
    paymentIntentCheck = {
      ok: true,
      count: matches.length,
      paymentIntents: matches.map(intent => ({
        id: intent.id,
        status: intent.status,
        livemode: intent.livemode,
        amount: intent.amount,
        amountReceived: intent.amount_received,
        currency: intent.currency,
      })),
      hasMore: intents.has_more,
    };
  } catch (error) {
    const details = safeStripeError(error);
    console.error("stripe_test_payment_intent_lookup_failed", details);
    paymentIntentCheck = { ok: false, error: details };
  }

  return respond(200, { ready: true, mode: "test", apiCheck, sessionCheck, paymentIntentCheck });
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
              "payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_refunded_amount_fils,paid_at,stripe_payment_currency,stripe_payment_amount_minor,stripe_exchange_rate,stripe_exchange_rate_source,stripe_exchange_rate_updated_at,stripe_refunded_amount_minor",
            ).limit(0),
            supabase.from("orders").select(
              "payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_refunded_amount_fils,paid_at,stripe_payment_currency,stripe_payment_amount_minor,stripe_exchange_rate,stripe_exchange_rate_source,stripe_exchange_rate_updated_at,stripe_refunded_amount_minor",
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
    if (action === "diagnostics") return await diagnoseStripe(input);
    if (action === "create") return await createSession(input);
    if (action === "cancel") return await cancelSession(input);
    return respond(400, { error: "Unknown Stripe checkout action." });
  } catch (error) {
    const details = safeStripeError(error);
    console.error("stripe_checkout_request_failed", details);
    if (details.statusCode === 400 && details.message.toLowerCase().includes("invalid currency: usd")) {
      return respond(422, { error: "stripe_usd_currency_not_enabled" });
    }
    return respond(503, { error: "Stripe Test Mode is temporarily unavailable." });
  }
});
