import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { db, inquiriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetStoreResponse, ListProductsResponse, GetProductParams, GetProductResponse,
  GetCartResponse, UpdateCartBody, UpdateCartResponse, StartCheckoutBody, StartCheckoutResponse,
  CreateInquiryBody, CreateInquiryResponse, TrackOrderBody, TrackOrderResponse,
} from "@workspace/api-zod";
import { getCatalog, productByHandle } from "../lib/catalog";
import { rawCart, cartId, presentCart, mutateCart, checkout, readiness } from "../lib/cart";
import { HttpError } from "../lib/errors";

const router = Router();
const mutationLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Please wait before trying again. / يرجى الانتظار قبل المحاولة مجدداً." } });
const inquiryLimit = rateLimit({ windowMs: 60 * 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Please try later. / طلبات كثيرة. يرجى المحاولة لاحقاً." } });

router.get("/store", async (_req, res): Promise<void> => {
  res.json(GetStoreResponse.parse(await readiness()));
});
router.get("/products", async (_req, res): Promise<void> => {
  res.json(ListProductsResponse.parse(await getCatalog()));
});
router.get("/products/:handle", async (req, res): Promise<void> => {
  const { handle } = GetProductParams.parse(req.params);
  if (!/^[a-z0-9-]+$/.test(handle)) throw new HttpError(400, "Invalid product handle.");
  res.json(GetProductResponse.parse(await productByHandle(handle)));
});
router.get("/cart", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.json(GetCartResponse.parse(await presentCart(await rawCart(cartId(req)))));
});
router.post("/cart", mutationLimit, async (req, res): Promise<void> => {
  const body = UpdateCartBody.parse(req.body);
  res.setHeader("Cache-Control", "no-store");
  res.json(UpdateCartResponse.parse(await mutateCart(req, res, body)));
});
router.post("/checkout", mutationLimit, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.json(StartCheckoutResponse.parse(await checkout(req, StartCheckoutBody.parse(req.body))));
});
router.post("/wholesale", inquiryLimit, async (req, res): Promise<void> => {
  const input = CreateInquiryBody.parse(req.body);
  if (![input.cafeName, input.contactName, input.area, input.products].every(s => s.trim().length)) throw new HttpError(400, "Please complete all required fields. / يرجى إكمال الحقول المطلوبة.");
  if (!/^\+?[\d\s()-]{8,30}$/.test(input.phone)) throw new HttpError(400, "Enter a valid phone number. / يرجى إدخال رقم هاتف صحيح.");
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let [row] = await db.insert(inquiriesTable).values({ ...input, requestHash })
    .onConflictDoNothing({ target: inquiriesTable.requestKey }).returning();
  if (!row) [row] = await db.select().from(inquiriesTable).where(eq(inquiriesTable.requestKey, input.requestKey));
  if (!row || row.requestHash !== requestHash) throw new HttpError(409, "This submission key has already been used. Reload the form. / يرجى إعادة تحميل النموذج.");
  const { requestHash: _hash, ...inquiry } = row;
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(CreateInquiryResponse.parse({ ...inquiry, createdAt: inquiry.createdAt.toISOString() }));
});
router.post("/tracking", inquiryLimit, async (req, res): Promise<void> => {
  TrackOrderBody.parse(req.body);
  res.setHeader("Cache-Control", "no-store");
  // This connection does not grant order/customer-data access. Do not fabricate
  // a local order or leak existence by guessing customer records.
  res.json(TrackOrderResponse.parse({
    available: false, statusUrl: "",
    message: "Use the secure order-status link in your Shopify order confirmation. Lookup by order number and phone requires an approved order-data integration and is not enabled yet. / يرجى استخدام رابط متابعة الطلب الآمن في رسالة تأكيد Shopify. البحث برقم الطلب والهاتف يحتاج ربطاً معتمداً ببيانات الطلبات ولم يُفعّل بعد.",
  }));
});
export default router;
