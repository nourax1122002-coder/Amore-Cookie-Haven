import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./errors";

// Live Kuwait API only. There is deliberately no demo-token or sandbox fallback.
const API = "https://api.myfatoorah.com";
export const moneyToFils = (value: string | number): number => {
  const text = String(value);
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new HttpError(409, "Invalid KWD amount.");
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(amount) || amount > 2_000_000_000) throw new HttpError(409, "Invalid KWD amount.");
  return amount;
};
export function paymentConfiguration() {
  const missing: string[] = [];
  if (process.env.NODE_ENV !== "production") missing.push("production deployment");
  for (const flag of ["MYFATOORAH_LIVE_ENABLED", "MYFATOORAH_ACCOUNT_APPROVED", "MYFATOORAH_FEES_APPROVED", "MYFATOORAH_DELIVERY_APPROVED"]) {
    if (process.env[flag] !== "true") missing.push(flag);
  }
  for (const key of ["MYFATOORAH_API_KEY", "MYFATOORAH_WEBHOOK_SECRET", "SESSION_SECRET"]) if (!process.env[key]?.trim()) missing.push(key);
  const shipping = process.env.MYFATOORAH_SHIPPING_FILS;
  if (!shipping || !/^\d{1,7}$/.test(shipping)) missing.push("MYFATOORAH_SHIPPING_FILS");
  let origin = "";
  try {
    const url = new URL(process.env.PAYMENT_PUBLIC_ORIGIN ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      /(^localhost$|\.replit\.dev$|^127\.|\.local$)/i.test(url.hostname)) throw new Error();
    origin = url.origin;
  } catch { missing.push("PAYMENT_PUBLIC_ORIGIN"); }
  return { ready: missing.length === 0, missing, origin, shippingFils: shipping && /^\d{1,7}$/.test(shipping) ? Number(shipping) : null };
}
export async function myfatoorahRequest<T>(path: string, body?: unknown): Promise<T> {
  const key = process.env.MYFATOORAH_API_KEY;
  if (!key) throw new HttpError(503, "Payments are not configured. / الدفع غير مفعّل.");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
  } catch { throw new HttpError(503, "Payment verification is pending. Please do not pay again. / جارٍ التحقق من العملية، لا تعيدي الدفع."); }
  // Never propagate provider bodies: they can include card tokens/customer data.
  const data = await response.json().catch(() => null) as { IsSuccess?: boolean; Data?: unknown } | null;
  if (!response.ok || data?.IsSuccess !== true || !data.Data) throw new HttpError(503, "The payment provider could not complete the request. / تعذر إتمام الطلب لدى مزود الدفع.");
  return data.Data as T;
}
export const paymentDetailsSchema = z.object({
  Invoice: z.object({ Id: z.coerce.string(), Status: z.string(), ExternalIdentifier: z.string().nullable() }),
  Transaction: z.object({ Status: z.string(), PaymentId: z.string() }),
  Amount: z.object({
    BaseCurrency: z.string(), ValueInBaseCurrency: z.union([z.string(), z.number()]),
    PayCurrency: z.string(), ValueInPayCurrency: z.union([z.string(), z.number()]),
  }),
});
export type PaymentDetails = z.infer<typeof paymentDetailsSchema>;
export function verifyDetails(details: PaymentDetails, order: { id: string; invoiceId: string | null; totalFils: number }, paymentId: string) {
  if (details.Invoice.Id !== order.invoiceId || details.Invoice.ExternalIdentifier !== order.id ||
    details.Transaction.PaymentId !== paymentId || details.Amount.BaseCurrency !== "KWD" ||
    details.Amount.PayCurrency !== "KWD" || moneyToFils(details.Amount.ValueInBaseCurrency) !== order.totalFils ||
    moneyToFils(details.Amount.ValueInPayCurrency) !== order.totalFils) {
    throw new HttpError(409, "Payment details do not match this order. / بيانات الدفع لا تطابق الطلب.");
  }
  if (details.Invoice.Status === "PAID" && details.Transaction.Status === "SUCCESS") return "paid";
  if (details.Transaction.Status === "CANCELED") return "cancelled";
  if (details.Transaction.Status === "FAILED") return "failed";
  return "pending";
}
export const webhookSchema = z.object({
  Event: z.object({ Code: z.literal(1), Name: z.literal("PAYMENT_STATUS_CHANGED"), CountryIsoCode: z.literal("KWT") }),
  Data: z.object({
    Invoice: z.object({ Id: z.coerce.string(), Status: z.string(), ExternalIdentifier: z.string().nullable() }),
    Transaction: z.object({ Status: z.string(), PaymentId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }),
  }),
});
export function validWebhookSignature(payload: z.infer<typeof webhookSchema>, signature: string, secret: string) {
  const { Invoice, Transaction } = payload.Data;
  // Official Webhook V2 PAYMENT_STATUS_CHANGED field order; NOT raw-body JSON HMAC.
  const canonical = `Invoice.Id=${Invoice.Id},Invoice.Status=${Invoice.Status},Transaction.Status=${Transaction.Status},Transaction.PaymentId=${Transaction.PaymentId},Invoice.ExternalIdentifier=${Invoice.ExternalIdentifier ?? ""}`;
  const expected = createHmac("sha256", secret).update(canonical, "utf8").digest();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function safePaymentUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
    !(url.hostname === "myfatoorah.com" || url.hostname.endsWith(".myfatoorah.com")) ||
    /(^|\.)(demo|apitest)\./i.test(url.hostname)) throw new HttpError(502, "Invalid payment redirect.");
  return url.toString();
}
