import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import {
  getCustomerOrder, getCustomerOrderByNumber, getLatestOrderForCart, insertCustomerOrder,
  listCustomerOrders, updateCustomerOrder,
  type CustomerOrder, type OrderItem,
} from "@workspace/db";
import { StartCheckoutBody } from "@workspace/api-zod";
import { getCatalog } from "./catalog";
import { cartId, rawCart } from "./cart";
import { readSettings } from "./store-settings";
import { normalizePhone, phoneMatches } from "./phone";
import { HttpError } from "./errors";
import { checkoutAddress } from "./delivery-address";
import { reserveStock, releaseStock, stockLock } from "./order-stock";
import { getAuthenticatedUser } from "./auth";
import {
  cancelStripeTestCheckout, createStripeTestCheckout, stripeTestAvailability,
  safeStripeTestCheckoutUrl,
} from "./stripe-functions";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function moneyToFils(value: number | string) {
  const raw = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(raw)) throw new HttpError(409, "Invalid product price.");
  const [whole, decimal = ""] = raw.split(".");
  const amount = Number(whole) * 1000 + Number(decimal.padEnd(3, "0"));
  if (!Number.isSafeInteger(amount)) throw new HttpError(409, "Invalid product price.");
  return amount;
}
function receiptToken(id: string) {
  if (!process.env.SESSION_SECRET) throw new HttpError(503, "Session security is not configured.");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`amore-order:${id}`).digest("hex");
}
function tokenMatches(order: CustomerOrder, token: string) {
  return /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(order.tokenHash, "hex"));
}
export async function findOrder(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, "Order not found.");
  const order = await getCustomerOrder(id);
  if (!order) throw new HttpError(404, "Order not found.");
  return order;
}
export async function authorizedOrder(id: string, token: string) {
  const order = await findOrder(id);
  if (!tokenMatches(order, token)) throw new HttpError(404, "Order not found.");
  return order;
}
export function orderSummary(order: CustomerOrder) {
  return {
    number: order.number, stage: order.paymentStatus === "cancelled" ? "cancelled" : order.fulfillmentStatus,
    financialStatus: order.paymentStatus.toUpperCase(),
    fulfillmentStatus: order.fulfillmentStatus.toUpperCase(), createdAt: order.createdAt.toISOString(),
    total: (order.totalFils / 1000).toFixed(3), currency: "KWD",
    items: order.items.map(({ title, quantity }) => ({ title, quantity })), hasMoreItems: false,
  };
}
export async function paymentAvailability() {
  const settings = await readSettings();
  const stripe = await stripeTestAvailability();
  const shippingFils = Number.isSafeInteger(settings.deliveryFeeFils) && settings.deliveryFeeFils! >= 0
    ? settings.deliveryFeeFils! : null;
  return { shippingFils, stripeTestEnabled: stripe.stripeTestEnabled && shippingFils !== null };
}
function resultUrl(order: CustomerOrder, origin: string) {
  const state = order.paymentStatus === "paid" ? "success" : order.paymentStatus === "failed" ? "failure"
    : order.paymentStatus === "cancelled" ? "cancelled" : "pending";
  const provider = order.paymentProvider === "stripe" ? "&provider=stripe" : "";
  return `${origin}/payment/${state}?order=${order.id}&token=${receiptToken(order.id)}${provider}`;
}
function requestOrigin(req: Request, fallback: string) {
  const origin = req.get("origin");
  try {
    const parsed = new URL(origin || fallback);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    const replitHost = parsed.hostname.endsWith(".replit.dev") || parsed.hostname.endsWith(".replit.app");
    const vercelHost = parsed.hostname.endsWith(".vercel.app");
    const configuredOrigin = Boolean(fallback) && parsed.origin === fallback;
    if ((!local && parsed.protocol !== "https:") || (local && !["http:", "https:"].includes(parsed.protocol))
      || (!local && !replitHost && !vercelHost && !configuredOrigin)
      || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error();
    return parsed.origin;
  } catch {
    throw new HttpError(400, "The secure checkout origin could not be verified.");
  }
}
export async function localCheckout(req: Request, body: ReturnType<typeof StartCheckoutBody.parse>, res?: Response) {
  const settings = await readSettings();
  const stripe = await stripeTestAvailability();
  const shippingFils = Number.isSafeInteger(settings.deliveryFeeFils) && settings.deliveryFeeFils! >= 0
    ? settings.deliveryFeeFils! : null;
  if (!stripe.stripeTestEnabled || shippingFils === null) {
    throw new HttpError(503, "Stripe Test Mode is not configured. / وضع اختبار Stripe غير مهيأ.");
  }
  const origin = requestOrigin(req, process.env.PAYMENT_PUBLIC_ORIGIN?.trim() ?? "");
  const phone = normalizePhone(body.phone ?? "");
  if (!phone || !phone.startsWith("965") || phone.length !== 11) throw new HttpError(400, "Enter a Kuwait phone number. / يرجى إدخال رقم هاتف كويتي صحيح.");
  const address = checkoutAddress(body.address);
  if (!body.requestKey) throw new HttpError(400, "Checkout reference is missing. Refresh the page.");
  const id = cartId(req);
  const cart = await rawCart(id);
  if (!id || !cart?.lines.nodes.length) throw new HttpError(409, "Your bag is empty. / السلة فارغة.");
  const account = res ? await getAuthenticatedUser(req, res) : null;
  if (cart.discountCodes.some(c => c.applicable)) throw new HttpError(409, "Discount codes must be removed before direct payment. / يرجى إزالة رمز الخصم قبل الدفع المباشر.");
  const catalog = await getCatalog(true);
  const aggregate = new Map<string, number>();
  for (const line of cart.lines.nodes) aggregate.set(line.merchandise.id, (aggregate.get(line.merchandise.id) ?? 0) + line.quantity);
  const items: OrderItem[] = [...aggregate].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, quantity]) => {
    const product = catalog.find(p => p.variantId === variantId);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) throw new HttpError(409, "Requested stock is not available. / الكمية المطلوبة غير متوفرة.");
    const unitFils = moneyToFils(product.price);
    if (!unitFils) throw new HttpError(409, "A product price requires review.");
    return { variantId, quantity, title: product.title, unitFils };
  });
  const subtotalFils = items.reduce((sum, item) => sum + item.unitFils * item.quantity, 0);
  const totalFils = subtotalFils + shippingFils;
  if (!Number.isSafeInteger(totalFils) || totalFils > 2_000_000_000) throw new HttpError(409, "Invalid order total.");
  const cartHash = digest(id);
  const requestPayload = { cartHash, items, address, phone, note: body.note ?? "", totalFils };
  const requestHash = digest(JSON.stringify({ ...requestPayload, provider: "stripe" }));
  return stockLock(async () => {
    // Prevent another Checkout session for the same cart, including a double-click/new tab.
    let order = await getLatestOrderForCart(cartHash);
    if (order && !(order.stockStatus === "released" && order.paymentStatus !== "paid")) {
      if (order.requestHash !== requestHash) throw new HttpError(409, "This bag already has a payment attempt. Review its order before starting again. / للسلة محاولة دفع مسجلة؛ راجعي طلبك قبل إنشاء محاولة جديدة.");
        if (order.paymentStatus === "paid") return { url: resultUrl(order, origin) };
       if (order.paymentUrl && order.expiresAt > new Date() && order.stockStatus === "reserved") {
          return { url: safeStripeTestCheckoutUrl(order.paymentUrl) };
       }
      // Unknown POST outcome: NEVER create another invoice automatically.
      throw new HttpError(409, "This payment needs review. Do not pay again. / هذه العملية تحتاج مراجعة، لا تعيدي الدفع.");
    }
    for (const item of items) {
      const product = catalog.find(p => p.variantId === item.variantId)!;
      if (!product.available || item.quantity > product.stock) throw new HttpError(409, "Requested stock is not available. / الكمية المطلوبة غير متوفرة.");
    }
    const orderId = randomUUID();
    order = await insertCustomerOrder({
      id: orderId, number: `AM-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
      cartHash, requestKey: body.requestKey!, requestHash, tokenHash: digest(receiptToken(orderId)),
        phone, address, note: body.note ?? "", items, subtotalFils, shippingFils, totalFils,
        paymentProvider: "stripe",
      userId: account?.id ?? null,
      // Stripe requires a Checkout Session to expire at least 30 minutes after
      // the create request. Keep a buffer for network latency and use the same
      // persisted deadline in the Edge Function.
      expiresAt: new Date(Date.now() + 40 * 60_000),
    });
    if (!order) throw new HttpError(503, "Order could not be saved.");
    // No payment request is sent until reservation is durably confirmed.
    await reserveStock(order);
    await updateCustomerOrder(order.id, { paymentStatus: "creating", updatedAt: new Date() });
    try {
      const url = await createStripeTestCheckout({
        orderId: order.id, token: receiptToken(order.id), origin, lang: body.lang ?? "en",
      });
      return { url };
    } catch (error) {
      // Keep stock reserved after an ambiguous API result; a signed webhook may
      // still confirm that Stripe created and completed the session.
      await updateCustomerOrder(order.id, { paymentStatus: "review", updatedAt: new Date() });
      throw error;
    }
  });
}
export async function cancelStripeOrder(id: string, token: string) {
  const order = await authorizedOrder(id, token);
  if (order.paymentProvider !== "stripe") throw new HttpError(404, "Order not found.");
  if (["paid", "partially_refunded", "refunded"].includes(order.paymentStatus)) {
    return { status: order.paymentStatus };
  }
  return cancelStripeTestCheckout({ orderId: id, token });
}
export async function localTracking(number: string, phone: string) {
  const order = await getCustomerOrderByNumber(number.replace(/^#/, "").toUpperCase());
  const matched = order && phoneMatches(phone, order.phone);
  return matched ? { available: true, statusUrl: "", message: "Order status from Amore Cookies. / حالة الطلب من أموري كوكيز.", order: orderSummary(order) }
    : { available: false, statusUrl: "", message: "We could not verify these Amore order details. / تعذر التحقق من بيانات طلب أموري." };
}
export async function localOrderList() {
  const rows = await listCustomerOrders(100);
  return rows.map(order => ({ id: order.id, ...orderSummary(order), phone: order.phone, address: order.address, note: order.note,
    subtotal: (order.subtotalFils / 1000).toFixed(3), shipping: (order.shippingFils / 1000).toFixed(3),
    stockStatus: order.stockStatus, invoiceId: order.invoiceId ?? "",
    paymentProvider: order.paymentProvider === "stripe" ? "stripe" : "legacy" }));
}
export async function updateFulfillment(id: string, stage: string) {
  const order = await findOrder(id);
  const path = ["confirmed", "preparing", "out_for_delivery", "delivered"];
  if (order.paymentStatus !== "paid" || order.stockStatus !== "reserved" ||
    path.indexOf(stage) !== path.indexOf(order.fulfillmentStatus) + 1) throw new HttpError(409, "Only paid orders can advance to the next delivery stage. / يمكن تحديث مرحلة التوصيل التالية للطلبات المدفوعة فقط.");
  await updateCustomerOrder(id, { fulfillmentStatus: stage, updatedAt: new Date() },
    { fulfillmentStatus: order.fulfillmentStatus });
}
