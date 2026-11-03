import { timingSafeEqual, createHash } from "node:crypto";
import { shopifyAdminRequest } from "./shopify-admin-api";
import { HttpError } from "./errors";

// Shopify remains the only order ledger. Never cache customer phone data.
export interface ShopifyOrder {
  name: string;
  phone?: string | null;
  shippingAddress?: { phone?: string | null } | null;
  confirmed: boolean;
  cancelledAt: string | null;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: { title: string; quantity: number }[]; pageInfo: { hasNextPage: boolean } };
  fulfillments: { displayStatus: string }[];
}

export const orderFields = `
  name confirmed cancelledAt createdAt displayFinancialStatus displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 50) { nodes { title quantity } pageInfo { hasNextPage } }
  fulfillments { displayStatus }
`;

export function normalizeOrderNumber(value: string): string | null {
  const normalized = value.trim().normalize("NFKC").replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632));
  return /^#?[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(normalized) ? normalized : null;
}

export function normalizePhone(value: string): string | null {
  const normalized = value.normalize("NFKC")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
  if (!/^\+?[\d ()-]+$/.test(normalized)) return null;
  let digits = normalized.replace(/\D/g, "").replace(/^00/, "");
  // The shop serves Kuwait; accept the local eight-digit representation too.
  if (digits.length === 8) digits = `965${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function phoneMatches(input: string, order: ShopifyOrder): boolean {
  const phone = normalizePhone(input);
  if (!phone) return false;
  return [order.phone, order.shippingAddress?.phone].some(candidate => {
    const actual = candidate ? normalizePhone(candidate) : null;
    return actual !== null && timingSafeEqual(createHash("sha256").update(phone).digest(), createHash("sha256").update(actual).digest());
  });
}

export function presentOrder(order: ShopifyOrder) {
  const fulfillment = order.displayFulfillmentStatus;
  const statuses = order.fulfillments.map(f => f.displayStatus);
  // Fulfilled means shipped, NOT delivered. Do not invent intermediate milestones.
  const stage = order.cancelledAt ? "cancelled"
    : fulfillment === "FULFILLED" && statuses.length > 0 && statuses.every(s => s === "DELIVERED") ? "delivered"
    : statuses.includes("OUT_FOR_DELIVERY") ? "out_for_delivery"
    : fulfillment === "PARTIALLY_FULFILLED" ? "partially_fulfilled"
    : fulfillment === "FULFILLED" || statuses.some(s => ["IN_TRANSIT", "CARRIER_PICKED_UP"].includes(s)) ? "shipped"
    : fulfillment === "IN_PROGRESS" ? "preparing"
    : order.confirmed ? "confirmed" : "received";
  return {
    number: order.name, stage, financialStatus: order.displayFinancialStatus ?? "UNKNOWN",
    fulfillmentStatus: fulfillment, createdAt: order.createdAt,
    total: order.currentTotalPriceSet.shopMoney.amount, currency: order.currentTotalPriceSet.shopMoney.currencyCode,
    items: order.lineItems.nodes.map(({ title, quantity }) => ({ title, quantity })),
    hasMoreItems: order.lineItems.pageInfo.hasNextPage,
  };
}

async function readOrders<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  try {
    return await shopifyAdminRequest<T>(query, variables);
  } catch {
    // Permission failures and upstream errors must never look like "not found".
    throw new HttpError(503, "Shopify tracking is unavailable. Use your Shopify confirmation link. / تتبع Shopify غير متاح حالياً. استخدمي رابط تأكيد الطلب.");
  }
}

export async function trackOrder(orderNumber: string, phone: string) {
  const miss = {
    available: false, statusUrl: "",
    message: "We could not verify these details. Check the order number and checkout phone, or use your Shopify confirmation link. / تعذر التحقق من البيانات. تحققي من رقم الطلب وهاتف الشراء أو استخدمي رابط تأكيد Shopify.",
  };
  const number = normalizeOrderNumber(orderNumber);
  if (!number || !normalizePhone(phone)) return miss;
  const result = await readOrders<{ orders: { nodes: ShopifyOrder[] } }>(`
    query TrackOrder($query: String!) {
      orders(first: 2, query: $query) { nodes { ${orderFields} phone shippingAddress { phone } } }
    }`, { query: `name:"${number}"` });
  const exact = result.orders.nodes.filter(o => o.name.replace(/^#/, "") === number.replace(/^#/, ""));
  if (exact.length !== 1 || !phoneMatches(phone, exact[0]!)) return miss;
  return {
    available: true, statusUrl: "", order: presentOrder(exact[0]!),
    message: "Live status from Shopify. / الحالة الفعلية من Shopify.",
  };
}

export async function listOrders(after?: string) {
  const data = await readOrders<{ orders: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(`
    query AdminOrders($after: String) {
      orders(first: 25, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes { ${orderFields} }
        pageInfo { hasNextPage endCursor }
      }
    }`, { after: after || null });
  return {
    orders: data.orders.nodes.map(presentOrder), hasNextPage: data.orders.pageInfo.hasNextPage,
    endCursor: data.orders.pageInfo.endCursor ?? "", refreshedAt: new Date().toISOString(),
  };
}
