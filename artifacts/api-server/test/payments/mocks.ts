export const fixture = {
  available: 11, reserves: 0, calls: 0, invoiceCalls: 0, timeout: false,
  products: [{ variantId: "gid://shopify/ProductVariant/fixture", title: "Fixture dough", price: 10, available: true, stock: 11 }],
  lines: [{ merchandise: { id: "gid://shopify/ProductVariant/fixture" }, quantity: 2 }],
  requests: new Map<string, string>(), details: new Map<string, unknown>(),
  invoices: new Map<string, unknown>(),
};
export const getCatalog = async () => fixture.products;
export const readSettings = async () => ({ checkoutEnabled: true });
export const cartId = (req: { fixtureCart?: string }) => req.fixtureCart;
export const rawCart = async () => ({ lines: { nodes: fixture.lines }, discountCodes: [] });
export async function shopifyAdminRequest(query: string, variables: any) {
  fixture.calls++;
  if (query.includes("productVariant(")) return { productVariant: { inventoryItem: {
    id: "fixture-inventory", tracked: true,
    inventoryLevels: { nodes: [{ location: { id: "fixture-location" }, quantities: [{ name: "available", quantity: fixture.available }] }] },
  } } };
  const payload = JSON.stringify(variables.input);
  if (fixture.requests.has(variables.key)) {
    if (fixture.requests.get(variables.key) !== payload) throw new Error("Idempotency key changed payload");
    return {};
  }
  const change = variables.input.quantities[0];
  if (change.changeFromQuantity !== fixture.available) throw new Error("CAS conflict");
  fixture.available = change.quantity;
  fixture.reserves++;
  fixture.requests.set(variables.key, payload);
  return {};
}
