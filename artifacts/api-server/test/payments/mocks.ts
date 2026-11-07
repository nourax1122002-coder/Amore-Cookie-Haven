export const fixture = {
  available: 11, reserves: 0, calls: 0, invoiceCalls: 0, timeout: false,
  products: [{
    id: "00000000-0000-4000-8000-000000000201",
    variantId: "00000000-0000-4000-8000-000000000201",
    title: "Fixture dough", price: 10, available: true, stock: 11,
  }],
  lines: [{ merchandise: { id: "00000000-0000-4000-8000-000000000201" }, quantity: 2 }],
  requests: new Map<string, string>(), details: new Map<string, unknown>(),
  invoices: new Map<string, unknown>(),
};

const orders = new Map<string, Record<string, any>>();
const locks = new Set<string>();
export const getCatalog = async () => fixture.products.map(product => ({
  ...product, stock: fixture.available, available: fixture.available > 0,
}));
export const readSettings = async () => ({ checkoutEnabled: true });
export const invalidateCatalog = () => {};
export const cartId = (req: { fixtureCart?: string }) => req.fixtureCart;
export const rawCart = async () => ({ lines: { nodes: fixture.lines }, discountCodes: [] });
export async function createSupabaseAuthClient() { throw new Error("Auth is not used in payment unit tests."); }
export async function saveUserProfile() { throw new Error("Auth is not used in payment unit tests."); }

export async function insertCustomerOrder(input: Record<string, any>) {
  const order: Record<string, any> = {
    ...input, createdAt: new Date(), updatedAt: new Date(), currency: "KWD",
    paymentStatus: "pending", fulfillmentStatus: "received", stockStatus: "unreserved",
    stockPlan: null, releasePlan: null, invoiceId: null, paymentId: null, paymentUrl: null, userId: null,
  };
  orders.set(order.id, order);
  return order;
}
export async function getCustomerOrder(id: string) { return orders.get(id); }
export async function getCustomerOrderByNumber(number: string) { return [...orders.values()].find(order => order.number === number); }
export async function getCustomerOrderByRequestKey(key: string) { return [...orders.values()].find(order => order.requestKey === key); }
export async function getLatestOrderForCart(hash: string) {
  return [...orders.values()].filter(order => order.cartHash === hash)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}
export async function updateCustomerOrder(id: string, changes: Record<string, any>, expected: Record<string, any> = {}, notPaid = false) {
  const current = orders.get(id);
  if (!current || (notPaid && current.paymentStatus === "paid") ||
    Object.entries(expected).some(([key, value]) => current[key] !== value)) return undefined;
  const updated = { ...current, ...changes };
  orders.set(id, updated);
  return updated;
}
export async function listCustomerOrders(limit = 100) {
  return [...orders.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}
export async function listOrdersForReconciliation(paymentStatuses: string[], stockStatuses: string[], limit: number) {
  return [...orders.values()].filter(order => paymentStatuses.includes(order.paymentStatus) && stockStatuses.includes(order.stockStatus)).slice(0, limit);
}
export async function deleteCustomerOrders(ids: string[]) { for (const id of ids) orders.delete(id); }
export async function acquireNamedLock(name: string) {
  if (locks.has(name)) return false;
  locks.add(name);
  return true;
}
export async function renewNamedLock() { return true; }
export async function releaseNamedLock(name: string) { locks.delete(name); }
export async function reserveOrderProductStock(orderId: string) {
  fixture.calls++;
  const order = orders.get(orderId);
  if (!order) throw Object.assign(new Error("Missing test order"), { code: "P0002" });
  if (order.stockStatus === "reserved") return;
  const quantity = order.items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
  if (quantity > fixture.available) throw Object.assign(new Error("Insufficient test stock"), { code: "P0001" });
  fixture.available -= quantity;
  fixture.reserves++;
  order.stockStatus = "reserved";
  order.stockPlan = [{ productId: fixture.products[0]!.id, quantity }];
}
export async function releaseOrderProductStock(orderId: string) {
  const order = orders.get(orderId);
  if (!order) throw Object.assign(new Error("Missing test order"), { code: "P0002" });
  if (order.paymentStatus === "paid") throw Object.assign(new Error("Paid test order"), { code: "P0001" });
  if (order.stockStatus === "released") return;
  if (order.stockStatus !== "reserved") throw Object.assign(new Error("Unreserved test order"), { code: "P0001" });
  fixture.available += order.stockPlan.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
  order.stockStatus = "released";
}
