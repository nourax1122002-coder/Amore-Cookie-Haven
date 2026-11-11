import { HttpError } from "./errors";

export type StripeTestAvailability = {
  stripeTestEnabled: boolean;
};

type StripeFunctionResponse = {
  url?: unknown;
  status?: unknown;
  stripeTestEnabled?: unknown;
  ready?: unknown;
  mode?: unknown;
  reason?: unknown;
  apiCheck?: unknown;
  sessionCheck?: unknown;
  paymentIntentCheck?: unknown;
};

function functionUrl(): string | null {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!base || !key) return null;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) return null;
    return `${parsed.origin}/functions/v1/stripe-checkout`;
  } catch {
    return null;
  }
}

async function callStripeFunction(
  action: "availability" | "create" | "cancel" | "diagnostics",
  payload: Record<string, unknown> = {},
): Promise<StripeFunctionResponse> {
  const url = functionUrl();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new HttpError(503, "Stripe Test Mode is not configured in Supabase.");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(503, "Stripe Test Mode is temporarily unavailable. / وضع اختبار Stripe غير متاح مؤقتاً.");
  }
  const result = await response.json().catch(() => null) as StripeFunctionResponse | null;
  if (!response.ok || !result) {
    throw new HttpError(response.status === 404 ? 503 : response.status, "Stripe Test Mode could not complete the request. / تعذر إكمال الطلب بوضع اختبار Stripe.");
  }
  return result;
}

export async function stripeTestAvailability(): Promise<StripeTestAvailability> {
  try {
    const result = await callStripeFunction("availability");
    return { stripeTestEnabled: result.stripeTestEnabled === true };
  } catch {
    return { stripeTestEnabled: false };
  }
}

export async function createStripeTestCheckout(input: {
  orderId: string;
  token: string;
  origin: string;
  lang: "ar" | "en";
}): Promise<string> {
  const result = await callStripeFunction("create", input);
  if (typeof result.url !== "string") throw new HttpError(503, "Stripe Test Mode did not return a checkout link.");
  return safeStripeTestCheckoutUrl(result.url);
}

export async function cancelStripeTestCheckout(input: { orderId: string; token: string }) {
  return callStripeFunction("cancel", input);
}

export async function diagnoseStripeTestCheckout(input: { orderId: string; createdAt: string }) {
  return callStripeFunction("diagnostics", input);
}

export function safeStripeTestCheckoutUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(502, "Invalid Stripe Test Mode redirect.");
  }
  if (url.protocol !== "https:" || url.username || url.password
    || url.hostname !== "checkout.stripe.com" || !url.pathname.startsWith("/c/pay/cs_test_")) {
    throw new HttpError(502, "Invalid Stripe Test Mode redirect.");
  }
  return url.toString();
}
