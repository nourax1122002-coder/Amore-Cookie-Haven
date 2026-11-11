import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  createCartRow, deleteCartItemRow, getCartRow, getProductRowById, listCartItemRows,
  listProductRows, updateCartItemRow, updateCartNoteRow, upsertCartItemRow,
} from "@workspace/db";
import { GetCartResponse, UpdateCartBody } from "@workspace/api-zod";
import { readSettings } from "./store-settings";
import { HttpError } from "./errors";
import { stripeTestAvailability } from "./stripe-functions";

type RawLine = {
  id: string;
  quantity: number;
  cost: { totalAmount: { amount: string; currencyCode: "KWD" } };
  merchandise: {
    id: string;
    price: { amount: string; currencyCode: "KWD" };
    product: { handle: string; title: string; featuredImage: { url: string } };
  };
};
type RawCart = {
  id: string;
  totalQuantity: number;
  discountCodes: Array<{ code: string; applicable: boolean }>;
  cost: { subtotalAmount: { amount: string; currencyCode: "KWD" }; totalAmount: { amount: string; currencyCode: "KWD" } };
  lines: { nodes: RawLine[] };
};

const cookieName = "amore_cart";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function cartId(req: Request): string | undefined {
  const value = req.signedCookies?.[cookieName];
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

function rememberCart(req: Request, res: Response, id: string) {
  res.cookie(cookieName, id, {
    httpOnly: true, signed: true, sameSite: "lax",
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    path: "/api", maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export async function rawCart(id?: string): Promise<RawCart | null> {
  if (!id || !uuidPattern.test(id)) return null;
  const cart = await getCartRow(id);
  if (!cart) return null;
  const items = await listCartItemRows(id);
  if (!items.length) return { id, totalQuantity: 0, discountCodes: [], cost: {
    subtotalAmount: { amount: "0.000", currencyCode: "KWD" }, totalAmount: { amount: "0.000", currencyCode: "KWD" },
  }, lines: { nodes: [] } };
  const products = await listProductRows(true);
  const byId = new Map(products.map(product => [product.id, product]));
  const lines = items.flatMap(item => {
    const product = byId.get(item.productId);
    if (!product) return [];
    const amount = (Math.round(Number(product.price) * 1000) / 1000).toFixed(3);
    return [{
      id: item.id,
      quantity: item.quantity,
      cost: { totalAmount: { amount: (Number(amount) * item.quantity).toFixed(3), currencyCode: "KWD" as const } },
      merchandise: {
        id: product.id,
        price: { amount, currencyCode: "KWD" as const },
        product: { handle: product.handle, title: product.title, featuredImage: { url: product.imageUrl } },
      },
    }];
  });
  const subtotalFils = lines.reduce((sum, line) => sum + Math.round(Number(line.merchandise.price.amount) * 1000) * line.quantity, 0);
  const subtotal = (subtotalFils / 1000).toFixed(3);
  return {
    id,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    discountCodes: [],
    cost: { subtotalAmount: { amount: subtotal, currencyCode: "KWD" }, totalAmount: { amount: subtotal, currencyCode: "KWD" } },
    lines: { nodes: lines },
  };
}

export async function readiness() {
  const settings = await readSettings();
  const [stripe, shippingFils] = await Promise.all([
    stripeTestAvailability(),
    Promise.resolve(settings.deliveryFeeFils),
  ]);
  const checkoutReady = stripe.stripeTestEnabled && shippingFils !== null;
  const launchMessage = checkoutReady
    ? "Stripe Test Mode is ready. No real payments are accepted. / وضع اختبار Stripe جاهز، ولن تُقبل مدفوعات حقيقية."
    : "Stripe Test Mode is not configured yet. / لم يكتمل إعداد وضع اختبار Stripe بعد.";
  return { settings, shopCurrency: "KWD", checkoutReady, launchMessage };
}

export async function presentCart(cart: RawCart | null) {
  const ready = await readiness();
  const lines = cart?.lines.nodes.map(line => ({
    id: line.id,
    variantId: line.merchandise.id,
    handle: line.merchandise.product.handle,
    title: line.merchandise.product.title,
    quantity: line.quantity,
    price: Number(line.merchandise.price.amount),
    imageUrl: line.merchandise.product.featuredImage.url,
  })) ?? [];
  const subtotalFils = lines.reduce((sum, line) => sum + Math.round(line.price * 1000) * line.quantity, 0);
  const subtotal = subtotalFils / 1000;
  return GetCartResponse.parse({
    lines, subtotal, total: subtotal, discount: 0, currency: "KWD",
    checkoutReady: ready.checkoutReady, message: ready.launchMessage, discountCodes: [],
  });
}

function assertAvailable(product: Awaited<ReturnType<typeof getProductRowById>>, requested: number) {
  if (!product?.isActive || !Number.isInteger(requested) || requested < 1 || requested > product.stock) {
    throw new HttpError(409, "Requested quantity is not available. / الكمية المطلوبة غير متوفرة.");
  }
}

async function ensureCart(req: Request, res: Response) {
  const existingId = cartId(req);
  if (existingId && await getCartRow(existingId)) return existingId;
  const id = randomUUID();
  await createCartRow(id);
  rememberCart(req, res, id);
  return id;
}

export async function mutateCart(req: Request, res: Response, body: ReturnType<typeof UpdateCartBody.parse>) {
  let id = cartId(req);
  let cart = id ? await rawCart(id) : null;
  if (body.action === "add") {
    if (!body.variantId || !body.quantity) throw new HttpError(400, "Select a product and quantity.");
    const product = await getProductRowById(body.variantId);
    if (!product?.isActive) throw new HttpError(404, "Product not found. / المنتج غير موجود.");
    const existing = cart?.lines.nodes.filter(line => line.merchandise.id === product.id).reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    assertAvailable(product, existing + body.quantity);
    id = await ensureCart(req, res);
    await upsertCartItemRow(id, product.id, existing + body.quantity);
  } else {
    if (!id || !cart) throw new HttpError(409, "Your cart is empty or expired. / السلة فارغة أو انتهت صلاحيتها.");
    switch (body.action) {
      case "update": {
        const line = cart.lines.nodes.find(item => item.id === body.lineId);
        if (!line || !body.quantity) throw new HttpError(400, "Choose a valid cart item and quantity.");
        const product = await getProductRowById(line.merchandise.id);
        const otherQuantity = cart.lines.nodes.filter(item => item.id !== line.id && item.merchandise.id === line.merchandise.id)
          .reduce((sum, item) => sum + item.quantity, 0);
        assertAvailable(product, otherQuantity + body.quantity);
        if (!await updateCartItemRow(id, line.id, body.quantity)) throw new HttpError(404, "Cart item not found.");
        break;
      }
      case "remove": {
        if (!cart.lines.nodes.some(item => item.id === body.lineId)) throw new HttpError(404, "Cart item not found.");
        await deleteCartItemRow(id, body.lineId!);
        break;
      }
      case "discount":
        if (body.code?.trim()) throw new HttpError(409, "Discount codes are not enabled for direct checkout. / أكواد الخصم غير مفعّلة للدفع المباشر.");
        break;
      case "note":
        await updateCartNoteRow(id, body.note ?? "");
        break;
      default:
        throw new HttpError(400, "Invalid cart operation.");
    }
  }
  cart = await rawCart(id);
  return presentCart(cart);
}
