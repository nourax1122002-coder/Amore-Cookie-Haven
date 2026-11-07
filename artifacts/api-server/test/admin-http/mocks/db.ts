// Schema definitions are safe to reuse: never import the real database entrypoint.
import { inquiriesTable } from "../../../../../lib/db/src/schema/inquiries";
import { storeSettingsTable } from "../../../../../lib/db/src/schema/store-settings";
export { inquiriesTable, storeSettingsTable };
export { customerOrdersTable } from "../../../../../lib/db/src/schema/customer-orders";

const fixture = () => ({
  id: 17, cafeName: "Fictional cafe", contactName: "Test contact",
  phone: "+96550000000", email: "cafe@example.invalid", area: "Test area",
  products: "Test cookies", notes: "", requestKey: "fictional-request-key",
  requestHash: "fictional-request-hash", status: "new",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});
export const state = {
  calls: [] as string[],
  settings: null as Record<string, unknown> | null,
  inquiry: fixture(),
};
export function resetDatabase() {
  state.calls = [];
  state.settings = null;
  state.inquiry = fixture();
}
export async function readSettingsRow() {
  state.calls.push("select");
  return state.settings ? { id: "amore", content: state.settings, updatedAt: new Date() } : undefined;
}
export async function writeSettingsRow(content: Record<string, unknown>) {
  state.calls.push("insert");
  state.settings = structuredClone(content);
  return { id: "amore", content: state.settings, updatedAt: new Date() };
}
export async function updateInquiry(_id: number, data: { status: string }) {
  state.calls.push("update");
  state.inquiry = { ...state.inquiry, ...data };
  return state.inquiry;
}
export async function getInquiryCounts() { state.calls.push("select"); return { total: 1, fresh: 1 }; }
export async function listInquiries() { state.calls.push("select"); return [state.inquiry]; }
export async function createInquiry(input: Record<string, any>) {
  return { ...state.inquiry, ...input };
}
export async function incrementSecurityCounter() { throw new Error("Unexpected security counter call"); }
export async function deleteSecurityCounter() {}
export async function pruneSecurityCounters() {}
export async function readActiveSecurityCounter() { return undefined; }
export async function claimSecurityLease() { return true; }
export async function releaseSecurityLease() {}
export async function setSecurityCooldown() {}
export async function getCustomerOrder() { return undefined; }
export async function getCustomerOrderByNumber() { return undefined; }
export async function getCustomerOrderByRequestKey() { return undefined; }
export async function getLatestOrderForCart() { return undefined; }
export async function insertCustomerOrder() { throw new Error("Unexpected order insert"); }
export async function updateCustomerOrder() { return undefined; }
export async function listCustomerOrders() { return []; }
export async function listOrdersForReconciliation() { return []; }
export async function deleteCustomerOrders() {}
export async function acquireNamedLock() { return true; }
export async function renewNamedLock() { return true; }
export async function releaseNamedLock() {}
