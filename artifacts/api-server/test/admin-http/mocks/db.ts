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
  products: [] as Record<string, any>[],
};
const productId = "00000000-0000-4000-8000-000000000101";
const initialProduct = () => ({
  id: productId, handle: "existing-cookie", title: "Existing cookie", titleAr: "منتج موجود",
  description: "Existing product", descriptionAr: "منتج موجود", price: 10, currency: "KWD",
  pieces: 12, imageUrl: "https://amore-project.supabase.co/storage/v1/object/public/amore-products/existing.png",
  stock: 11, lowStockThreshold: 1, ingredients: "", ingredientsAr: "", isActive: true,
});
export function resetDatabase() {
  state.calls = [];
  state.settings = null;
  state.inquiry = fixture();
  state.products = [initialProduct()];
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
export async function listProductRows() { state.calls.push("listProducts"); return state.products; }
export async function getProductRowByHandle(handle: string) { state.calls.push("getProduct"); return state.products.find(p => p.handle === handle); }
export async function getProductRowById(id: string) { state.calls.push("getProduct"); return state.products.find(p => p.id === id); }
export async function saveProductRow(input: Record<string, any>) {
  state.calls.push("saveProduct");
  const handle = input.handle || input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const saved = { ...input, id: input.id ?? "00000000-0000-4000-8000-000000000102", handle, currency: "KWD", isActive: true };
  state.products = input.id ? state.products.map(p => p.id === input.id ? saved : p) : [...state.products, saved];
  return saved;
}
export async function uploadProductImage(name: string) {
  state.calls.push("uploadImage");
  return `https://amore-project.supabase.co/storage/v1/object/public/amore-products/${name}`;
}
export async function createCartRow() { throw new Error("Unexpected cart write in admin boundary test."); }
export async function getCartRow() { return undefined; }
export async function listCartItemRows() { return []; }
export async function upsertCartItemRow() { throw new Error("Unexpected cart write in admin boundary test."); }
export async function updateCartItemRow() { return undefined; }
export async function deleteCartItemRow() {}
export async function updateCartNoteRow() {}
export async function attachCartToUser() {}
export async function saveUserProfile() { throw new Error("Unexpected profile write in admin boundary test."); }
export async function createSupabaseAuthClient() { throw new Error("Unexpected Auth network request in admin boundary test."); }
export async function reserveOrderProductStock() { throw new Error("Unexpected stock reservation in admin boundary test."); }
export async function releaseOrderProductStock() { throw new Error("Unexpected stock release in admin boundary test."); }
