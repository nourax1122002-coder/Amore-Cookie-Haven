import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import {
  getCustomerOrder, getCustomerOrderByNumber, getLatestOrderForCart, insertCustomerOrder,
  listCustomerOrders, listOrdersForReconciliation, updateCustomerOrder,
  type CustomerOrder, type OrderItem,
} from "@workspace/db";
import { StartCheckoutBody } from "@workspace/api-zod";
import { getCatalog } from "./catalog";
import { cartId, rawCart } from "./cart";
import { readSettings } from "./store-settings";
import { normalizePhone, phoneMatches } from "./phone";
import { HttpError } from "./errors";
import { checkoutAddress } from "./delivery-address";
import {
  moneyToFils, myfatoorahRequest, paymentConfiguration, paymentDetailsSchema,
  safePaymentUrl, verifyDetails,
} from "./myfatoorah";
import { reserveStock, releaseStock, stockLock } from "./order-stock";
import { getAuthenticatedUser } from "./auth";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
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
let methodsCache: { expires: number; methods: string[] } | undefined;
export async function enabledMethods() {
  if (methodsCache && methodsCache.expires > Date.now()) return methodsCache.methods;
  const response = await myfatoorahRequest<{ PaymentMethods: { ApiName: string; CurrencyIso: string }[] }>("/v3/payment-methods");
  const methods = response.PaymentMethods.filter(m => m.CurrencyIso === "KWD").map(m => m.ApiName.toUpperCase());
  if (!methods.includes("KNET") || !methods.includes("CARD")) throw new HttpError(503, "Activate KNET and Visa/Mastercard with MyFatoorah first. / يرجى تفعيل كي نت وفيزا وماستر كارد لدى ماي فاتورة.");
  methodsCache = { expires: Date.now() + 30 * 60_000, methods };
  return methods;
}
export async function paymentAvailability() {
  const config = paymentConfiguration();
  const settings = await readSettings();
  return { enabled: config.ready && settings.checkoutEnabled, shippingFils: config.shippingFils,
    methods: config.ready && settings.checkoutEnabled ? await enabledMethods() : [] };
}
function resultUrl(order: CustomerOrder) {
  const state = order.paymentStatus === "paid" ? "success" : order.paymentStatus === "failed" ? "failure"
    : order.paymentStatus === "cancelled" ? "cancelled" : "pending";
  return `${paymentConfiguration().origin}/payment/${state}?order=${order.id}&token=${receiptToken(order.id)}`;
}
export async function localCheckout(req: Request, body: ReturnType<typeof StartCheckoutBody.parse>, res?: Response) {
  const config = paymentConfiguration();
  if (!config.ready || !(await readSettings()).checkoutEnabled) throw new HttpError(503, "Live payments are awaiting merchant approval and configuration. / الدفع الحقيقي بانتظار اعتماد حساب التاجر وإكمال الإعدادات.");
  const phone = normalizePhone(body.phone ?? "");
  if (!phone || !phone.startsWith("965") || phone.length !== 11) throw new HttpError(400, "Enter a Kuwait phone number. / يرجى إدخال رقم هاتف كويتي صحيح.");
  const address = checkoutAddress(body.address);
  if (!body.requestKey) throw new HttpError(400, "Checkout reference is missing. Refresh the page.");
  await enabledMethods(); // Never create a payable invoice with missing required methods.
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
  const totalFils = subtotalFils + config.shippingFils!;
  if (!Number.isSafeInteger(totalFils) || totalFils > 2_000_000_000) throw new HttpError(409, "Invalid order total.");
  const cartHash = digest(id);
  const requestHash = digest(JSON.stringify({ cartHash, items, address, phone, note: body.note ?? "", totalFils }));
  return stockLock(async () => {
    // Prevent another invoice for the same cart, including a double-click/new tab.
    let order = await getLatestOrderForCart(cartHash);
    if (order && !(order.stockStatus === "released" && order.paymentStatus !== "paid")) {
      if (order.requestHash !== requestHash) throw new HttpError(409, "This bag already has a payment attempt. Review its order before starting again. / للسلة محاولة دفع مسجلة؛ راجعي طلبك قبل إنشاء محاولة جديدة.");
      if (order.paymentStatus === "paid") return { url: resultUrl(order) };
      if (order.paymentUrl && order.expiresAt > new Date() && order.stockStatus === "reserved") return { url: safePaymentUrl(order.paymentUrl) };
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
      phone, address, note: body.note ?? "", items, subtotalFils, shippingFils: config.shippingFils!, totalFils,
      userId: account?.id ?? null,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    if (!order) throw new HttpError(503, "Order could not be saved.");
    // No payment request is sent until reservation is durably confirmed.
    await reserveStock(order);
    const state = `order=${order.id}&token=${receiptToken(order.id)}`;
    await updateCustomerOrder(order.id, { paymentStatus: "creating", updatedAt: new Date() });
    try {
      const payment = await myfatoorahRequest<{ InvoiceId: string; PaymentURL: string }>("/v3/payments", {
        Order: { Amount: totalFils / 1000, Currency: "KWD", ExternalIdentifier: order.id },
        PaymentExpiry: order.expiresAt.toISOString(), OperationType: "PAY", NotificationOption: "LINK",
        Customer: { Reference: order.number, Mobile: { CountryCode: "965", Number: phone.slice(3) } },
        IntegrationUrls: { Redirection: `${config.origin}/api/payments/callback?${state}`, Webhook: `${config.origin}/api/payments/webhook` },
        Language: body.lang === "ar" ? "AR" : "EN",
        DisplayPaymentMethods: ["knet", "card", "applepay"],
      });
      const url = safePaymentUrl(payment.PaymentURL);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(payment.InvoiceId))) throw new HttpError(502, "Invalid payment invoice.");
      await updateCustomerOrder(order.id, { invoiceId: String(payment.InvoiceId), paymentUrl: url, updatedAt: new Date() });
      return { url };
    } catch (error) {
      // Keep stock reserved: a timed-out API call may have created a payable invoice.
      // The authenticated webhook can recover the invoice binding via ExternalIdentifier.
      await updateCustomerOrder(order.id, { paymentStatus: "review", updatedAt: new Date() });
      throw error;
    }
  });
}
export async function verifyPayment(orderId: string, paymentId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(paymentId)) throw new HttpError(400, "Invalid payment reference.");
  const details = paymentDetailsSchema.parse(await myfatoorahRequest(`/v3/payments/${encodeURIComponent(paymentId)}`));
  return stockLock(async () => {
    let order = await findOrder(orderId);
    if (!order.invoiceId && details.Invoice.ExternalIdentifier === order.id && order.stockStatus === "reserved") {
      // Recover only by independently authenticated GET, never by trusting webhook JSON.
      const recovered = await updateCustomerOrder(order.id, { invoiceId: details.Invoice.Id });
      if (!recovered) throw new HttpError(409, "Payment invoice could not be bound to this order.");
      order = recovered;
    }
    if (!order) throw new HttpError(404, "Order not found.");
    const status = verifyDetails(details, order, paymentId);
    if (order.paymentStatus === "paid") return order; // paid is monotonic.
    const review = status === "paid" && order.stockStatus !== "reserved";
    const updated = await updateCustomerOrder(order.id, {
      paymentStatus: status, paymentId: status === "paid" ? paymentId : order.paymentId,
      fulfillmentStatus: status === "paid" ? (review ? "review" : "confirmed") : order.fulfillmentStatus,
      updatedAt: new Date(),
    }, {}, true);
    return updated ?? await findOrder(order.id);
  });
}
export async function callbackResult(id: string, token: string, paymentId: string) {
  await authorizedOrder(id, token);
  return resultUrl(await verifyPayment(id, paymentId));
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
    stockStatus: order.stockStatus, invoiceId: order.invoiceId ?? "" }));
}
export async function updateFulfillment(id: string, stage: string) {
  const order = await findOrder(id);
  const path = ["confirmed", "preparing", "out_for_delivery", "delivered"];
  if (order.paymentStatus !== "paid" || order.stockStatus !== "reserved" ||
    path.indexOf(stage) !== path.indexOf(order.fulfillmentStatus) + 1) throw new HttpError(409, "Only paid orders can advance to the next delivery stage. / يمكن تحديث مرحلة التوصيل التالية للطلبات المدفوعة فقط.");
  await updateCustomerOrder(id, { fulfillmentStatus: stage, updatedAt: new Date() },
    { fulfillmentStatus: order.fulfillmentStatus });
}
// Reconcile abandoned attempts too: closing the browser must not lose a payment.
// Never release stock solely because a callback said "failed" or time elapsed.
export async function reconcileOrder(id: string) {
  let order = await findOrder(id);
  if (order.paymentStatus === "paid" || order.stockStatus === "released") return;
  if (!order.invoiceId && order.paymentStatus === "pending") {
    // No provider POST was started. Finish a durable ambiguous stock write with
    // its ORIGINAL idempotency key, then safely return that reservation.
    await stockLock(async () => {
      order = await findOrder(id);
      if (order.paymentStatus !== "pending" || order.invoiceId) return;
      if (order.stockStatus === "unreserved") {
        await updateCustomerOrder(id, { stockStatus: "released", paymentStatus: "cancelled" });
        return;
      }
      await reserveStock(order);
      order = await findOrder(id);
      await releaseStock(order);
      await updateCustomerOrder(id, { paymentStatus: "cancelled" });
    });
    return;
  }
  const invoice = await myfatoorahRequest<{
    Invoice: { Id: string; Status: string; ExternalIdentifier: string; ExpirationDate: string };
    Transactions: { PaymentId: string; Status: string }[];
  }>(order.invoiceId ? `/v3/invoices/${encodeURIComponent(order.invoiceId)}` : `/v3/invoices/externalIdentifier/${encodeURIComponent(order.id)}`);
  if ((order.invoiceId && String(invoice.Invoice.Id) !== order.invoiceId) || invoice.Invoice.ExternalIdentifier !== order.id) throw new HttpError(409, "Invoice mismatch.");
  if (!order.invoiceId) {
    await updateCustomerOrder(id, { invoiceId: String(invoice.Invoice.Id) });
    order = await findOrder(id);
  }
  const success = invoice.Transactions.find(t => t.Status === "SUCCESS");
  if (success) { await verifyPayment(order.id, success.PaymentId); return; }
  const expiry = new Date(invoice.Invoice.ExpirationDate).getTime();
  if (invoice.Invoice.Status !== "PENDING" || !Number.isFinite(expiry) || Date.now() < expiry + 10 * 60_000 ||
    invoice.Transactions.some(t => !["FAILED", "CANCELED"].includes(t.Status))) return;
  await stockLock(async () => {
    order = await findOrder(id);
    if (order.paymentStatus === "paid") return;
    await releaseStock(order);
    await updateCustomerOrder(id, { paymentStatus: "cancelled", updatedAt: new Date() });
  });
}
let reconciling = false;
export async function runPaymentReconciliation() {
  if (!process.env.MYFATOORAH_API_KEY) return { enabled: false, processed: 0 };
  if (reconciling) return { enabled: true, processed: 0 };
  reconciling = true;
  try {
    const rows = await listOrdersForReconciliation(
      ["pending", "creating", "failed", "cancelled", "review"],
      ["reserved", "reserving", "releasing"], 10,
    );
    for (const row of rows) {
      try { await reconcileOrder(row.id); } catch { /* keep held/pending; visible to the owner, never invent success */ }
      await updateCustomerOrder(row.id, { updatedAt: new Date() });
    }
    return { enabled: true, processed: rows.length };
  } finally {
    reconciling = false;
  }
}

export function startPaymentReconciliation() {
  const timer = setInterval(() => {
    void runPaymentReconciliation().catch(() => {
      // DB/provider unavailable: leave persisted state unchanged.
    });
  }, 60_000);
  timer.unref();
}
