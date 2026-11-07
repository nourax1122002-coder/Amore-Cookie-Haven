import type { CustomerOrder } from "@workspace/db";
import {
  acquireNamedLock, releaseNamedLock, renewNamedLock,
  reserveOrderProductStock, releaseOrderProductStock,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { invalidateCatalog } from "./catalog";
import { HttpError } from "./errors";

// Database leases serialize invoice creation; stock mutations themselves are
// atomic PostgreSQL functions that lock and update the affected product rows.
export async function stockLock<T>(work: () => Promise<T>) {
  const name = "amore-supabase-checkout";
  const owner = randomUUID();
  const leaseMs = 5 * 60_000;
  const deadline = Date.now() + 30_000;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    acquired = await acquireNamedLock(name, owner, leaseMs);
    if (!acquired) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!acquired) throw new HttpError(503, "Inventory is busy. Please retry shortly. / المخزون مشغول، يرجى إعادة المحاولة قريباً.");
  const heartbeat = setInterval(() => {
    void renewNamedLock(name, owner, leaseMs).catch(() => {});
  }, 60_000);
  heartbeat.unref();
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await releaseNamedLock(name, owner).catch(() => {});
  }
}

export async function reserveStock(order: CustomerOrder) {
  if (order.stockStatus === "reserved") return;
  try {
    await reserveOrderProductStock(order.id);
    invalidateCatalog();
  } catch (error) {
    if ((error as { code?: string })?.code === "P0001" || (error as { code?: string })?.code === "P0002") {
      throw new HttpError(409, "Requested stock is not available. / الكمية المطلوبة غير متوفرة.");
    }
    throw error;
  }
}

export async function releaseStock(order: CustomerOrder) {
  if (order.stockStatus === "released") return;
  if (order.paymentStatus === "paid") throw new HttpError(409, "Inventory cannot be released.");
  try {
    await releaseOrderProductStock(order.id);
    invalidateCatalog();
  } catch (error) {
    if ((error as { code?: string })?.code === "P0001" || (error as { code?: string })?.code === "P0002") {
      throw new HttpError(409, "Inventory cannot be released.");
    }
    throw error;
  }
}
