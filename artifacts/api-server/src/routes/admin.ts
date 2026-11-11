import { Router, raw as rawBody } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getInquiryCounts, listInquiries, updateInquiry } from "@workspace/db";
import {
  GetAdminSessionResponse, GetAdminSummaryResponse, GetAdminSettingsResponse,
  SaveSettingsBody, SaveSettingsResponse, ListInquiriesResponse, UpdateInquiryParams,
  UpdateInquiryBody, UpdateInquiryResponse, ListAdminProductsResponse, SaveProductBody, SaveProductResponse,
} from "@workspace/api-zod";
import { approvedAdminEmails, isAdministrator, requireAdmin } from "../middlewares/security";
import { getCatalog, saveCatalogProduct } from "../lib/catalog";
import { readSettings, writeSettings } from "../lib/store-settings";
import { readiness } from "../lib/cart";
import { HttpError } from "../lib/errors";
import { createSignedProductImageUpload, uploadProductImage } from "@workspace/db";

const router = Router();
router.use("/admin", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/admin/me", async (req, res): Promise<void> => {
  res.json(GetAdminSessionResponse.parse({ isAdmin: await isAdministrator(req, res), setupRequired: !approvedAdminEmails().length }));
});
router.use("/admin", requireAdmin);
router.get("/admin/summary", async (_req, res): Promise<void> => {
  const [inquiries, products, ready] = await Promise.all([getInquiryCounts(), getCatalog(true), readiness()]);
  res.json(GetAdminSummaryResponse.parse({
    inquiryCount: inquiries.total, newInquiryCount: inquiries.fresh,
    lowStock: products.filter(p => p.stock <= p.lowStockThreshold),
    shopCurrency: ready.shopCurrency,
    checkoutEnabled: ready.checkoutReady,
    notices: [
      ...(ready.launchMessage ? [ready.launchMessage] : []),
      "Products, inventory, customer accounts and orders are stored in Supabase. / المنتجات والمخزون وحسابات العملاء والطلبات محفوظة في Supabase.",
    ],
  }));
});
router.get("/admin/settings", async (_req, res): Promise<void> => {
  res.json(GetAdminSettingsResponse.parse(await readSettings()));
});
router.put("/admin/settings", async (req, res): Promise<void> => {
  const input = SaveSettingsBody.parse(req.body);
  if (input.whatsapp && !/^\+?[1-9]\d{7,14}$/.test(input.whatsapp)) throw new HttpError(400, "Use an approved international WhatsApp number (digits only, optional +). / استخدمي رقم واتساب المعتمد بالصيغة الدولية.");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new HttpError(400, "Enter a valid email.");
  for (const key of ["logoImage", "bakerImage", "packageImage", "cookieImage"] as const) {
    if (!(input[key].startsWith("/images/") || /^https:\/\/\S+$/.test(input[key]))) throw new HttpError(400, "Image paths must start with /images/ or https://.");
  }
  res.json(SaveSettingsResponse.parse(await writeSettings(input)));
});
router.get("/admin/inquiries", async (_req, res): Promise<void> => {
  const rows = await listInquiries(500);
  res.json(ListInquiriesResponse.parse(rows.map(({ requestHash: _hash, ...r }) => ({ ...r, createdAt: r.createdAt.toISOString() }))));
});
router.patch("/admin/inquiries/:id", async (req, res): Promise<void> => {
  const { id } = UpdateInquiryParams.parse(req.params);
  const data = UpdateInquiryBody.parse(req.body);
  const row = await updateInquiry(Number(id), data);
  if (!row) throw new HttpError(404, "Inquiry not found.");
  res.json(UpdateInquiryResponse.parse({ ...row, createdAt: row.createdAt.toISOString() }));
});
router.get("/admin/products", async (_req, res): Promise<void> => {
  res.json(ListAdminProductsResponse.parse(await getCatalog(true)));
});
router.post("/admin/products", async (req, res): Promise<void> => {
  res.json(SaveProductResponse.parse(await saveCatalogProduct(SaveProductBody.parse(req.body))));
});
router.post("/admin/product-images/sign", async (req, res): Promise<void> => {
  const contentType = z.enum(["image/jpeg", "image/png", "image/webp"]).parse(req.body?.contentType);
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  const upload = await createSignedProductImageUpload(`${randomUUID()}.${extension}`);
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json({ uploadUrl: upload.signedUrl, imageUrl: upload.imageUrl });
});
router.post("/admin/product-images", rawBody({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }), async (req, res): Promise<void> => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "Choose a valid product image.");
  const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "";
  if (!extension) throw new HttpError(415, "Only JPG, PNG, and WebP product images are supported.");
  const imageUrl = await uploadProductImage(`${randomUUID()}.${extension}`, req.body, contentType);
  res.status(201).json({ imageUrl });
});
export default router;
