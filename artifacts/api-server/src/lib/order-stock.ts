import type { CustomerOrder, StockQuantity } from "@workspace/db";
import { db, customerOrdersTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { shopifyAdminRequest } from "./shopify-admin-api";
import { HttpError } from "./errors";

// A session advisory lock survives individual commits, but releases on disconnect.
// It serializes this storefront's reserve/release operations across all instances.
export async function stockLock<T>(work: () => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(91704221)");
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock(91704221)").catch(() => {});
    client.release();
  }
}
async function quantities(order: CustomerOrder, release: boolean): Promise<StockQuantity[]> {
  const result: StockQuantity[] = [];
  for (const item of order.items) {
    const data = await shopifyAdminRequest<{ productVariant: { inventoryItem: { id: string; tracked: boolean; inventoryLevels: { nodes: { location: { id: string }; quantities: { name: string; quantity: number }[] }[] } } } | null }>(
      `query($id:ID!) { productVariant(id:$id) { inventoryItem { id tracked inventoryLevels(first:50) { nodes {
        location { id } quantities(names:["available"]) { name quantity }
      } } } } }`, { id: item.variantId });
    const inventory = data.productVariant?.inventoryItem;
    // Split-stock locations need a separate fulfillment policy; never guess.
    if (!inventory?.tracked || inventory.inventoryLevels.nodes.length !== 1) throw new HttpError(409, "Inventory needs administrator review. / المخزون يحتاج مراجعة الإدارة.");
    const level = inventory.inventoryLevels.nodes[0]!;
    const available = level.quantities.find(q => q.name === "available")?.quantity;
    if (available === undefined || (!release && available < item.quantity)) throw new HttpError(409, "Insufficient stock. / الكمية المطلوبة غير متوفرة.");
    result.push({ inventoryItemId: inventory.id, locationId: level.location.id,
      changeFromQuantity: available, quantity: available + (release ? item.quantity : -item.quantity) });
  }
  return result;
}
async function apply(orderId: string, plan: StockQuantity[], release: boolean) {
  await shopifyAdminRequest(`mutation($input:InventorySetQuantitiesInput!,$key:String!) {
    inventorySetQuantities(input:$input) @idempotent(key:$key) {
      inventoryAdjustmentGroup { id } userErrors { field message }
    }
  }`, { key: `amore:${orderId}:${release ? "release" : "reserve"}`, input: {
    name: "available", reason: "correction", quantities: plan,
    referenceDocumentUri: `amore://orders/${orderId}`,
  } });
}
export async function reserveStock(order: CustomerOrder) {
  if (order.stockStatus === "reserved") return;
  if (!["unreserved", "reserving"].includes(order.stockStatus)) throw new HttpError(409, "Order inventory needs review.");
  const plan = order.stockPlan ?? await quantities(order, false);
  // Persist the exact request BEFORE the external write. Retry with the same
  // idempotency key and quantities after any timeout; never decrement twice.
  await db.update(customerOrdersTable).set({ stockPlan: plan, stockStatus: "reserving" }).where(eq(customerOrdersTable.id, order.id));
  await apply(order.id, plan, false);
  await db.update(customerOrdersTable).set({ stockStatus: "reserved" }).where(eq(customerOrdersTable.id, order.id));
}
export async function releaseStock(order: CustomerOrder) {
  if (order.stockStatus === "released") return;
  if (!["reserved", "releasing"].includes(order.stockStatus) || order.paymentStatus === "paid") throw new HttpError(409, "Inventory cannot be released.");
  const plan = order.releasePlan ?? await quantities(order, true);
  await db.update(customerOrdersTable).set({ releasePlan: plan, stockStatus: "releasing" }).where(eq(customerOrdersTable.id, order.id));
  await apply(order.id, plan, true);
  await db.update(customerOrdersTable).set({ stockStatus: "released" }).where(eq(customerOrdersTable.id, order.id));
}
