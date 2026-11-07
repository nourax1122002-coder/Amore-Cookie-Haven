import {
  getProductRowByHandle, getProductRowById, listProductRows, saveProductRow,
  type ProductRecord,
} from "@workspace/db";
import { ListProductsResponseItem, SaveProductBody } from "@workspace/api-zod";
import { HttpError } from "./errors";

function mapProduct(product: ProductRecord) {
  const price = Number(product.price);
  return ListProductsResponseItem.parse({
    id: product.id,
    handle: product.handle,
    title: product.title,
    titleAr: product.titleAr,
    description: product.description,
    descriptionAr: product.descriptionAr,
    price,
    currency: "KWD",
    shopCurrency: "KWD",
    pieces: product.pieces,
    imageUrl: product.imageUrl,
    variantId: product.id,
    available: product.isActive && product.stock > 0,
    stock: product.stock,
    lowStockThreshold: product.lowStockThreshold,
    ingredients: product.ingredients,
    ingredientsAr: product.ingredientsAr,
  });
}

let catalogCache: { expires: number; products: ReturnType<typeof mapProduct>[] } | undefined;
export function invalidateCatalog() { catalogCache = undefined; }

export async function getCatalog(fresh = false) {
  if (!fresh && catalogCache && Date.now() < catalogCache.expires) return catalogCache.products;
  const products = (await listProductRows()).map(mapProduct);
  catalogCache = { expires: Date.now() + 15_000, products };
  return products;
}

export async function getShopCurrency() { return "KWD"; }

export async function productByHandle(handle: string) {
  const product = await getProductRowByHandle(handle);
  if (!product) throw new HttpError(404, "Product not found. / المنتج غير موجود.");
  return mapProduct(product);
}

function makeHandle(title: string) {
  const slug = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return slug || `product-${crypto.randomUUID()}`;
}

function validateImageUrl(imageUrl: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new HttpError(503, "Product image storage is not configured.");
  let image: URL;
  let project: URL;
  try { image = new URL(imageUrl); project = new URL(supabaseUrl); }
  catch { throw new HttpError(400, "Use a public Amore product image in Supabase Storage."); }
  if (image.protocol !== "https:" || image.origin !== project.origin ||
    !image.pathname.startsWith("/storage/v1/object/public/amore-products/") ||
    image.pathname.includes("..")) {
    throw new HttpError(400, "Use a public Amore product image in Supabase Storage.");
  }
}

export async function saveCatalogProduct(input: ReturnType<typeof SaveProductBody.parse>) {
  if (input.id && !/^[0-9a-f-]{36}$/i.test(input.id)) throw new HttpError(400, "Invalid product.");
  validateImageUrl(input.imageUrl);
  const existing = input.id ? await getProductRowById(input.id) : undefined;
  if (input.id && !existing) throw new HttpError(404, "Product not found.");
  const saved = await saveProductRow({
    ...(existing ? { id: existing.id } : {}),
    handle: existing?.handle ?? makeHandle(input.title),
    title: input.title,
    titleAr: input.titleAr,
    description: input.description,
    descriptionAr: input.descriptionAr,
    price: input.price,
    currency: "KWD",
    pieces: input.pieces,
    imageUrl: input.imageUrl,
    stock: input.stock,
    lowStockThreshold: input.lowStockThreshold,
    ingredients: input.ingredients,
    ingredientsAr: input.ingredientsAr,
    isActive: true,
  });
  invalidateCatalog();
  return mapProduct(saved);
}
