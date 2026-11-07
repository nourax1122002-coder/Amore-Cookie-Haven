// No database connection is permitted in the HTTP boundary suite.
const counters = new Map<string, { hits: number; expiresAt: Date }>();
let failedScope: string | null = null;
export function failCounters(scope: string | null) { failedScope = scope; }
export async function incrementSecurityCounter(scope: string, hash: string, windowMs: number, cap: number) {
  if (failedScope === "all" || scope === failedScope) throw new Error("Fictional counter store failure");
  const key = `${scope}:${hash}`;
  let row = counters.get(key);
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    row = { hits: 0, expiresAt: new Date(Date.now() + windowMs) };
    counters.set(key, row);
  }
  row.hits = Math.min(row.hits + 1, cap);
  return { totalHits: row.hits, resetTime: row.expiresAt };
}
export async function deleteSecurityCounter(scope: string, hash: string) { counters.delete(`${scope}:${hash}`); }
export async function pruneSecurityCounters() {
  for (const [key, row] of counters) if (row.expiresAt.getTime() <= Date.now()) counters.delete(key);
}
export async function readActiveSecurityCounter() { return undefined; }
export async function claimSecurityLease() { return true; }
export async function releaseSecurityLease() {}
export async function setSecurityCooldown() {}
export async function createInquiry(input: Record<string, any>) {
  return { id: 1, ...input, status: "new", createdAt: new Date() };
}
export async function getCustomerOrder() { return undefined; }
export async function getCustomerOrderByNumber() { return undefined; }
export async function getCustomerOrderByRequestKey() { return undefined; }
export async function getLatestOrderForCart() { return undefined; }
export async function insertCustomerOrder() { throw new Error("Unexpected order insert in HTTP boundary test"); }
export async function updateCustomerOrder() { return undefined; }
export async function listCustomerOrders() { return []; }
export async function listOrdersForReconciliation() { return []; }
export async function deleteCustomerOrders() {}
export async function acquireNamedLock() { return true; }
export async function renewNamedLock() { return true; }
export async function releaseNamedLock() {}
export async function readSettingsRow() { return undefined; }
export async function writeSettingsRow(content: Record<string, unknown>) { return { id: "amore", content, updatedAt: new Date() }; }
export async function getInquiryCounts() { return { total: 1, fresh: 1 }; }
export async function listInquiries() { return []; }
export async function updateInquiry() { return undefined; }
export async function getProductRowByHandle() { return undefined; }
export async function getProductRowById() { return undefined; }
export async function listProductRows() { return []; }
export async function saveProductRow() { throw new Error("Unexpected product write in orders boundary test."); }
export async function createCartRow() { throw new Error("Unexpected cart write in orders boundary test."); }
export async function getCartRow() { return undefined; }
export async function listCartItemRows() { return []; }
export async function upsertCartItemRow() { throw new Error("Unexpected cart write in orders boundary test."); }
export async function updateCartItemRow() { return undefined; }
export async function deleteCartItemRow() {}
export async function updateCartNoteRow() {}
export async function attachCartToUser() {}
export async function saveUserProfile() { throw new Error("Unexpected profile write in orders boundary test."); }
export async function createSupabaseAuthClient() { throw new Error("Unexpected Auth network request in orders boundary test."); }
export async function reserveOrderProductStock() { throw new Error("Unexpected stock reservation in orders boundary test."); }
export async function releaseOrderProductStock() { throw new Error("Unexpected stock release in orders boundary test."); }
export async function uploadProductImage() { throw new Error("Unexpected product image upload in orders boundary test."); }

export { customerOrdersTable } from "../../../../../lib/db/src/schema/customer-orders";
