export type FlavorCatalogProduct = {
  variantId: string;
  title: string;
  price: number;
  available: boolean;
  stock: number;
};

export type FlavorProductResolution =
  | { status: "ready"; product: FlavorCatalogProduct }
  | { status: "not_published" | "not_mapped" | "unavailable" };

/**
 * Resolve purchases only from a published flavor's server-side mapping and
 * the current catalog. Never accept a product id or price from the browser.
 */
export function resolveFlavorRewardProduct(
  isPublished: boolean,
  mappedProductId: string | null,
  catalog: readonly FlavorCatalogProduct[],
): FlavorProductResolution {
  if (!isPublished) return { status: "not_published" };
  if (!mappedProductId) return { status: "not_mapped" };
  const product = catalog.find(candidate => candidate.variantId === mappedProductId);
  if (!product || !product.available || !Number.isSafeInteger(product.stock) || product.stock < 1
    || !Number.isFinite(product.price) || product.price <= 0) {
    return { status: "unavailable" };
  }
  return { status: "ready", product };
}
