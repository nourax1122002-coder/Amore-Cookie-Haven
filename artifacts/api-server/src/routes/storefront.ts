import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { createInquiry } from "@workspace/db";
import {
  GetStoreResponse, ListProductsResponse, GetProductParams, GetProductResponse,
  GetCartResponse, UpdateCartBody, UpdateCartResponse, StartCheckoutBody, StartCheckoutResponse,
  CreateInquiryBody, CreateInquiryResponse, TrackOrderBody, TrackOrderResponse,
  GetCurrencyConversionQueryParams, GetCurrencyConversionResponse,
} from "@workspace/api-zod";
import { getCatalog, productByHandle } from "../lib/catalog";
import { rawCart, cartId, presentCart, mutateCart, readiness } from "../lib/cart";
import { localCheckout, localTracking } from "../lib/local-orders";
import { HttpError } from "../lib/errors";
import { trackOrder } from "../lib/orders";
import { createTrackingLimits, trackingStoreUnavailable } from "../lib/tracking-limits";
import { currencyConversionService } from "../lib/currency-conversion";

const router = Router();
const mutationLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Please wait before trying again. / يرجى الانتظار قبل المحاولة مجدداً." } });
const inquiryLimit = rateLimit({ windowMs: 60 * 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Please try later. / طلبات كثيرة. يرجى المحاولة لاحقاً." } });
const conversionLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
const trackingLimits = createTrackingLimits();

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
router.get("/currency-conversion", conversionLimit, async (req, res): Promise<void> => {
  const query = GetCurrencyConversionQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Choose a valid KWD amount and display currency." });
    return;
  }
  try {
    const result = await currencyConversionService.convert(query.data.amount, query.data.currency);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.json(GetCurrencyConversionResponse.parse(result));
  } catch (error) {
    req.log.warn({ errorType: error instanceof Error ? error.name : "Error" }, "Currency conversion data unavailable");
    throw new HttpError(503, "Currency conversion is temporarily unavailable. Please try again later. / تحويل العملة غير متاح مؤقتاً. يرجى المحاولة لاحقاً.");
  }
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
  res.json(StartCheckoutResponse.parse(await localCheckout(req, StartCheckoutBody.parse(req.body))));
});
router.post("/wholesale", inquiryLimit, async (req, res): Promise<void> => {
  const input = CreateInquiryBody.parse(req.body);
  if (![input.cafeName, input.contactName, input.area, input.products].every(s => s.trim().length)) throw new HttpError(400, "Please complete all required fields. / يرجى إكمال الحقول المطلوبة.");
  if (!/^\+?[\d\s()-]{8,30}$/.test(input.phone)) throw new HttpError(400, "Enter a valid phone number. / يرجى إدخال رقم هاتف صحيح.");
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const row = await createInquiry({ ...input, requestHash });
  if (!row || row.requestHash !== requestHash) throw new HttpError(409, "This submission key has already been used. Reload the form. / يرجى إعادة تحميل النموذج.");
  const { requestHash: _hash, ...inquiry } = row;
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(CreateInquiryResponse.parse({ ...inquiry, createdAt: inquiry.createdAt.toISOString() }));
});
router.post("/tracking", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store"); next();
}, ...trackingLimits, trackingStoreUnavailable, async (req: Request, res: Response): Promise<void> => {
  const input = TrackOrderBody.parse(req.body);
  res.json(TrackOrderResponse.parse(await (/^#?AM-/i.test(input.orderNumber.trim())
    ? localTracking(input.orderNumber.trim(), input.phone) : trackOrder(input.orderNumber, input.phone))));
});
export default router;
