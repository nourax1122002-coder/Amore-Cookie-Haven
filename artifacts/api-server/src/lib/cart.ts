import type { Request, Response } from "express";
import { GetCartResponse, UpdateCartBody } from "@workspace/api-zod";
import { shopifyStorefrontRequest } from "./shopifyStorefrontClient";
import { getCatalog, getShopCurrency } from "./catalog";
import { readSettings } from "./store-settings";
import { HttpError } from "./errors";

const CART_FIELDS = `id checkoutUrl totalQuantity
  discountCodes { code applicable }
  cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
  lines(first:250) { nodes {
    id quantity cost { totalAmount { amount currencyCode } }
    merchandise { ... on ProductVariant {
      id price { amount currencyCode } product { handle title featuredImage { url } }
    } }
  } }`;
type RawCart = {
  id: string; checkoutUrl: string; totalQuantity: number;
  discountCodes: Array<{ code: string; applicable: boolean }>;
  cost: { subtotalAmount: { amount: string; currencyCode: string }; totalAmount: { amount: string; currencyCode: string } };
  lines: { nodes: Array<{ id: string; quantity: number; cost: { totalAmount: { amount: string; currencyCode: string } }; merchandise: {
    id: string; price: { amount: string; currencyCode: string }; product: { handle: string; title: string; featuredImage: { url: string } | null };
  } }> };
};
const cookieName = "amore_cart";
export function cartId(req: Request): string | undefined {
  const value = req.signedCookies?.[cookieName];
  return typeof value === "string" && value.startsWith("gid://shopify/Cart/") ? value : undefined;
}
function rememberCart(req: Request, res: Response, id: string) {
  res.cookie(cookieName, id, {
    httpOnly: true, signed: true, sameSite: "lax",
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    path: "/api", maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export async function rawCart(id?: string): Promise<RawCart | null> {
  if (!id) return null;
  const data = await shopifyStorefrontRequest<{ cart: RawCart | null }>(`query($id:ID!) { cart(id:$id) { ${CART_FIELDS} } }`, { id });
  return data.cart;
}

export async function readiness() {
  const [settings, shopCurrency] = await Promise.all([readSettings(), getShopCurrency()]);
  const checkoutReady = settings.checkoutEnabled && shopCurrency === "KWD";
  const launchMessage = shopCurrency !== "KWD"
    ? "Catalog prices are approved in KD. Ordering is paused until the store currency is set to KWD. / الأسعار المعتمدة بالدينار الكويتي. الطلب متوقف حتى ضبط عملة المتجر."
    : !settings.checkoutEnabled
      ? "Ordering opens after official delivery and payment settings are approved. / سيتم فتح الطلب بعد اعتماد إعدادات التوصيل والدفع الرسمية."
      : "";
  return { settings, shopCurrency, checkoutReady, launchMessage };
}

export async function presentCart(cart: RawCart | null) {
  const [ready, products] = await Promise.all([readiness(), cart ? getCatalog() : Promise.resolve([])]);
  const lines = cart?.lines.nodes.map(l => {
    const product = products.find(p => p.variantId === l.merchandise.id);
    return { id: l.id, variantId: l.merchandise.id, handle: l.merchandise.product.handle,
      title: product?.title ?? l.merchandise.product.title, quantity: l.quantity,
      price: product?.price ?? Number(l.merchandise.price.amount),
      imageUrl: product?.imageUrl ?? l.merchandise.product.featuredImage?.url ?? "" };
  }) ?? [];
  const rawCurrency = cart?.cost.totalAmount.currencyCode ?? ready.shopCurrency;
  // A KWD catalog quote is never a payable USD total. Checkout stays blocked.
  const quoted = rawCurrency !== "KWD";
  const subtotal = quoted ? lines.reduce((sum, l) => sum + Math.round(l.price * 1000) * l.quantity, 0) / 1000
    : Number(cart?.cost.subtotalAmount.amount ?? 0);
  const total = quoted ? subtotal : Number(cart?.cost.totalAmount.amount ?? 0);
  return GetCartResponse.parse({
    lines, subtotal, total, discount: Math.max(0, subtotal - total), currency: "KWD",
    checkoutReady: ready.checkoutReady && !quoted,
    message: ready.launchMessage,
    discountCodes: cart?.discountCodes ?? [],
  });
}

function assertCartErrors(errors: Array<{ message: string }>) {
  if (errors.length) throw new HttpError(400, errors.map(e => e.message).join(" "));
}

export async function mutateCart(req: Request, res: Response, body: ReturnType<typeof UpdateCartBody.parse>) {
  let cart = await rawCart(cartId(req));
  if (body.action === "add") {
    if (!body.variantId || !body.quantity) throw new HttpError(400, "Select a product and quantity.");
    const products = await getCatalog(true);
    const product = products.find(p => p.variantId === body.variantId);
    const existing = cart?.lines.nodes.filter(l => l.merchandise.id === body.variantId).reduce((n, l) => n + l.quantity, 0) ?? 0;
    if (!product?.available || body.quantity + existing > product.stock) throw new HttpError(409, "Requested quantity is not available. / الكمية المطلوبة غير متوفرة.");
    if (!cart) {
      const data = await shopifyStorefrontRequest<{ cartCreate: { cart: RawCart | null; userErrors: Array<{ message: string }> } }>(
        `mutation($i:CartInput!) { cartCreate(input:$i) { cart { ${CART_FIELDS} } userErrors { field message } } }`,
        { i: { buyerIdentity: { countryCode: "KW" }, lines: [{ merchandiseId: body.variantId, quantity: body.quantity }] } });
      assertCartErrors(data.cartCreate.userErrors);
      cart = data.cartCreate.cart;
      if (!cart) throw new HttpError(502, "Shopify could not create your cart.");
      rememberCart(req, res, cart.id);
    } else {
      const data = await shopifyStorefrontRequest<{ cartLinesAdd: { cart: RawCart; userErrors: Array<{ message: string }> } }>(
        `mutation($id:ID!,$lines:[CartLineInput!]!) { cartLinesAdd(cartId:$id,lines:$lines) { cart { ${CART_FIELDS} } userErrors { field message } } }`,
        { id: cart.id, lines: [{ merchandiseId: body.variantId, quantity: body.quantity }] });
      assertCartErrors(data.cartLinesAdd.userErrors); cart = data.cartLinesAdd.cart;
    }
  } else {
    if (!cart) throw new HttpError(409, "Your cart is empty or expired. / السلة فارغة أو انتهت صلاحيتها.");
    let query: string; let variables: Record<string, unknown>; let operation: string;
    switch (body.action) {
      case "update": {
        const line = cart.lines.nodes.find(l => l.id === body.lineId);
        if (!line || !body.quantity) throw new HttpError(400, "Choose a valid cart item and quantity.");
        const products = await getCatalog(true);
        const product = products.find(p => p.variantId === line.merchandise.id);
        const otherQuantity = cart.lines.nodes.filter(l => l.id !== line.id && l.merchandise.id === line.merchandise.id).reduce((sum, l) => sum + l.quantity, 0);
        if (!product?.available || body.quantity + otherQuantity > product.stock) throw new HttpError(409, "Requested quantity is not available. / الكمية المطلوبة غير متوفرة.");
        operation = "cartLinesUpdate";
        query = `mutation($id:ID!,$lines:[CartLineUpdateInput!]!) { cartLinesUpdate(cartId:$id,lines:$lines) { cart { ${CART_FIELDS} } userErrors { message } } }`;
        variables = { id: cart.id, lines: [{ id: line.id, quantity: body.quantity }] }; break;
      }
      case "remove": {
        if (!cart.lines.nodes.some(l => l.id === body.lineId)) throw new HttpError(400, "Cart item not found.");
        operation = "cartLinesRemove";
        query = `mutation($id:ID!,$lines:[ID!]!) { cartLinesRemove(cartId:$id,lineIds:$lines) { cart { ${CART_FIELDS} } userErrors { message } } }`;
        variables = { id: cart.id, lines: [body.lineId] }; break;
      }
      case "discount": {
        if (await getShopCurrency() !== "KWD") throw new HttpError(409, "Discounts become available after KWD checkout is configured. / يتاح الخصم بعد ضبط الدفع بالدينار الكويتي.");
        operation = "cartDiscountCodesUpdate";
        query = `mutation($id:ID!,$codes:[String!]!) { cartDiscountCodesUpdate(cartId:$id,discountCodes:$codes) { cart { ${CART_FIELDS} } userErrors { message } } }`;
        variables = { id: cart.id, codes: body.code?.trim() ? [body.code.trim()] : [] }; break;
      }
      case "note": {
        operation = "cartNoteUpdate";
        query = `mutation($id:ID!,$note:String!) { cartNoteUpdate(cartId:$id,note:$note) { cart { ${CART_FIELDS} } userErrors { message } } }`;
        variables = { id: cart.id, note: body.note ?? "" }; break;
      }
      default: throw new HttpError(400, "Invalid cart operation.");
    }
    const result = await shopifyStorefrontRequest<Record<string, { cart: RawCart; userErrors: Array<{ message: string }> }>>(query, variables);
    const updated = result[operation]!;
    assertCartErrors(updated.userErrors); cart = updated.cart;
  }
  return presentCart(cart);
}

export async function checkout(req: Request, body: { email?: string; phone?: string; note?: string }) {
  const ready = await readiness();
  if (!ready.checkoutReady) throw new HttpError(409, ready.launchMessage);
  const cart = await rawCart(cartId(req));
  if (!cart || !cart.lines.nodes.length) throw new HttpError(409, "Your cart is empty. / السلة فارغة.");
  if (cart.cost.totalAmount.currencyCode !== "KWD") throw new HttpError(409, "Recreate your cart after the currency change. / يرجى إعادة إنشاء السلة بعد تغيير العملة.");
  const products = await getCatalog(true);
  for (const line of cart.lines.nodes) {
    const p = products.find(p => p.variantId === line.merchandise.id);
    if (!p?.available || line.quantity > p.stock) throw new HttpError(409, "An item is no longer available. Please review your cart. / يرجى مراجعة الكميات في السلة.");
  }
  const buyer = await shopifyStorefrontRequest<{ cartBuyerIdentityUpdate: { userErrors: Array<{ message: string }> } }>(
    `mutation($id:ID!,$b:CartBuyerIdentityInput!) { cartBuyerIdentityUpdate(cartId:$id,buyerIdentity:$b) { userErrors { message } } }`,
    { id: cart.id, b: { countryCode: "KW", ...(body.email ? { email: body.email } : {}), ...(body.phone ? { phone: body.phone } : {}) } });
  assertCartErrors(buyer.cartBuyerIdentityUpdate.userErrors);
  if (body.note !== undefined) {
    const noted = await shopifyStorefrontRequest<{ cartNoteUpdate: { userErrors: Array<{ message: string }> } }>(
      `mutation($id:ID!,$note:String!) { cartNoteUpdate(cartId:$id,note:$note) { userErrors { message } } }`, { id: cart.id, note: body.note });
    assertCartErrors(noted.cartNoteUpdate.userErrors);
  }
  const current = await rawCart(cart.id);
  if (!current?.checkoutUrl) throw new HttpError(502, "Checkout could not be created.");
  const url = new URL(current.checkoutUrl);
  if (url.protocol !== "https:") throw new HttpError(502, "Invalid checkout URL.");
  // Development-store password preview is explicit, never enabled for production.
  if (process.env.SHOPIFY_DEV_CHECKOUT_PREVIEW === "true" && process.env.NODE_ENV !== "production") url.searchParams.set("channel", "online_store");
  return { url: url.toString() };
}
