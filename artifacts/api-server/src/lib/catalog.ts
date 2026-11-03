import { shopifyStorefrontRequest } from "./shopifyStorefrontClient";
import { shopifyAdminRequest } from "./shopify-admin-api";
import { HttpError } from "./errors";
import { SaveProductBody, ListProductsResponseItem } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const PRODUCT_FIELDS = `
  id handle title description featuredImage { url }
  metafields(identifiers: [
    {namespace:"amore",key:"title_ar"},
    {namespace:"amore",key:"description_ar"},
    {namespace:"amore",key:"price_kwd"},
    {namespace:"amore",key:"pieces"},
    {namespace:"amore",key:"image_path"},
    {namespace:"amore",key:"low_stock_threshold"},
    {namespace:"amore",key:"ingredients"},
    {namespace:"amore",key:"ingredients_ar"}
  ]) { key value }
  variants(first:1) { nodes { id availableForSale quantityAvailable price { amount currencyCode } } }`;

type RawProduct = {
  id: string; handle: string; title: string; description: string;
  featuredImage: { url: string } | null;
  metafields: Array<{ key: string; value: string } | null>;
  variants: { nodes: Array<{ id: string; availableForSale: boolean; quantityAvailable: number | null; price: { amount: string; currencyCode: string } }> };
};
export function mapProduct(p: RawProduct) {
  const m = Object.fromEntries(p.metafields.filter((v): v is { key: string; value: string } => !!v).map(v => [v.key, v.value]));
  const v = p.variants.nodes[0];
  if (!v) throw new HttpError(502, "Shopify product variant is missing.");
  const approvedKwd = m.price_kwd !== undefined;
  return ListProductsResponseItem.parse({
    id: p.id, handle: p.handle, title: p.title, titleAr: m.title_ar ?? p.title,
    description: p.description, descriptionAr: m.description_ar ?? "",
    price: Number(v.price.currencyCode === "KWD" ? v.price.amount : approvedKwd ? m.price_kwd : v.price.amount),
    currency: approvedKwd ? "KWD" : v.price.currencyCode, shopCurrency: v.price.currencyCode,
    pieces: Number(m.pieces ?? 12),
    imageUrl: m.image_path || p.featuredImage?.url || "/images/amore-package.png",
    variantId: v.id, available: v.availableForSale && (v.quantityAvailable ?? 0) > 0,
    stock: Math.max(0, v.quantityAvailable ?? 0), lowStockThreshold: Number(m.low_stock_threshold ?? 0),
    ingredients: m.ingredients ?? "", ingredientsAr: m.ingredients_ar ?? "",
  });
}

let catalogCache: { expires: number; products: ReturnType<typeof mapProduct>[] } | undefined;
let currencyCache: { expires: number; value: string } | undefined;
export function invalidateCatalog() { catalogCache = undefined; currencyCache = undefined; }

export async function getCatalog(fresh = false) {
  if (!fresh && catalogCache && Date.now() < catalogCache.expires) return catalogCache.products;
  const data = await shopifyStorefrontRequest<{ products: { nodes: RawProduct[] } }>(
    `query { products(first:100, query:"tag:amore", sortKey:CREATED_AT) { nodes { ${PRODUCT_FIELDS} } } }`);
  const products = data.products.nodes.map(mapProduct);
  catalogCache = { expires: Date.now() + 30000, products };
  return products;
}

export async function getShopCurrency() {
  if (currencyCache && Date.now() < currencyCache.expires) return currencyCache.value;
  const data = await shopifyStorefrontRequest<{ shop: { paymentSettings: { currencyCode: string } } }>(
    "query { shop { paymentSettings { currencyCode } } }");
  currencyCache = { value: data.shop.paymentSettings.currencyCode, expires: Date.now() + 60000 };
  return currencyCache.value;
}

export async function productByHandle(handle: string) {
  const data = await shopifyStorefrontRequest<{ product: RawProduct | null }>(
    `query($handle:String!) { product(handle:$handle) { ${PRODUCT_FIELDS} } }`, { handle });
  if (!data.product) throw new HttpError(404, "Product not found. / المنتج غير موجود.");
  return mapProduct(data.product);
}

export const productMetafields = (p: ReturnType<typeof SaveProductBody.parse>) => [
  ["title_ar", p.titleAr, "single_line_text_field"],
  ["description_ar", p.descriptionAr, "multi_line_text_field"],
  ["price_kwd", String(p.price), "number_decimal"],
  ["pieces", String(p.pieces), "number_integer"],
  ["image_path", p.imageUrl, "single_line_text_field"],
  ["low_stock_threshold", String(p.lowStockThreshold), "number_integer"],
  ["ingredients", p.ingredients, "multi_line_text_field"],
  ["ingredients_ar", p.ingredientsAr, "multi_line_text_field"],
].filter(([, value]) => value !== "").map(([key, value, type]) => ({ namespace: "amore", key, value, type }));

export async function saveCatalogProduct(input: ReturnType<typeof SaveProductBody.parse>) {
  if (input.id && !/^gid:\/\/shopify\/Product\/\d+$/.test(input.id)) throw new HttpError(400, "Invalid Shopify product.");
  if (!(input.imageUrl.startsWith("/images/") || /^https:\/\//.test(input.imageUrl))) throw new HttpError(400, "Use an HTTPS image URL or a store /images/ path.");
  const metafields = productMetafields(input);
  // Empty ingredients/Arabic descriptions explicitly clear existing metadata.
  const optionalKeys = [["ingredients", input.ingredients], ["ingredients_ar", input.ingredientsAr], ["description_ar", input.descriptionAr], ["title_ar", input.titleAr]];
  let id = input.id;
  if (id) {
    await shopifyAdminRequest(`mutation($p:ProductUpdateInput!) {
      productUpdate(product:$p) { product { id } userErrors { field message } }
    }`, { p: { id, title: input.title, descriptionHtml: escapeHtml(input.description).replace(/\n/g, "<br>"), metafields } });
    const toDelete = optionalKeys.filter(([, value]) => !value).map(([key]) => ({ ownerId: id, namespace: "amore", key }));
    if (toDelete.length) await shopifyAdminRequest(`mutation($m:[MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields:$m) { deletedMetafields { key } userErrors { field message } }
    }`, { m: toDelete });
  } else {
    const data = await shopifyAdminRequest(`mutation($p:ProductCreateInput!) {
      productCreate(product:$p) { product { id } userErrors { field message } }
    }`, { p: { title: input.title, descriptionHtml: escapeHtml(input.description).replace(/\n/g, "<br>"), status: "ACTIVE", tags: ["amore"], metafields } });
    id = data.productCreate.product.id;
  }
  const data = await shopifyAdminRequest(`query($id:ID!) {
    product(id:$id) { id handle variants(first:1) { nodes { id inventoryItem { id } } } }
    locations(first:1) { nodes { id } }
    publications(first:20) { nodes { id name } }
  }`, { id });
  const variant = data.product.variants.nodes[0];
  const location = data.locations.nodes[0];
  if (!variant || !location) throw new HttpError(502, "Shopify inventory location is missing.");
  await shopifyAdminRequest(`mutation($id:ID!,$v:[ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId:$id,variants:$v) { productVariants { id } userErrors { field message } }
  }`, { id, v: [{ id: variant.id, price: String(input.price), inventoryPolicy: "DENY" }] });
  await shopifyAdminRequest(`mutation($id:ID!,$input:InventoryItemInput!) {
    inventoryItemUpdate(id:$id,input:$input) { inventoryItem { id } userErrors { field message } }
  }`, { id: variant.inventoryItem.id, input: { tracked: true } });
  const levels = await shopifyAdminRequest(`query($id:ID!,$loc:ID!) {
    inventoryItem(id:$id) { inventoryLevel(locationId:$loc) { id quantities(names:["available"]) { quantity } } }
  }`, { id: variant.inventoryItem.id, loc: location.id });
  if (!levels.inventoryItem.inventoryLevel) await shopifyAdminRequest(`mutation($id:ID!,$loc:ID!,$key:String!) {
    inventoryActivate(inventoryItemId:$id,locationId:$loc) @idempotent(key:$key) { inventoryLevel { id } userErrors { field message } }
  }`, { id: variant.inventoryItem.id, loc: location.id, key: randomUUID() });
  await shopifyAdminRequest(`mutation($i:InventorySetQuantitiesInput!,$key:String!) {
    inventorySetQuantities(input:$i) @idempotent(key:$key) { inventoryAdjustmentGroup { id } userErrors { field message } }
  }`, { key: randomUUID(), i: { name: "available", reason: "correction", quantities: [{ inventoryItemId: variant.inventoryItem.id, locationId: location.id, quantity: input.stock, changeFromQuantity: levels.inventoryItem.inventoryLevel?.quantities[0]?.quantity ?? 0 }] } });
  const publication = data.publications.nodes.find((p: { name: string }) => /replit/i.test(p.name));
  if (!publication) throw new HttpError(409, "Replit sales channel is not provisioned. Product saved but not published.");
  await shopifyAdminRequest(`mutation($id:ID!,$pub:ID!) {
    publishablePublish(id:$id,input:[{publicationId:$pub}]) { publishable { publishedOnPublication(publicationId:$pub) } userErrors { field message } }
  }`, { id, pub: publication.id });
  invalidateCatalog();
  return productByHandle(data.product.handle);
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
