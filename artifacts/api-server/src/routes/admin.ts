import { Router } from "express";
import { getInquiryCounts, listInquiries, updateInquiry } from "@workspace/db";
import {
  GetAdminSessionResponse, GetAdminSummaryResponse, GetAdminSettingsResponse,
  SaveSettingsBody, SaveSettingsResponse, ListInquiriesResponse, UpdateInquiryParams,
  UpdateInquiryBody, UpdateInquiryResponse, ListAdminProductsResponse, SaveProductBody, SaveProductResponse,
  ListAdminOrdersQueryParams, ListAdminOrdersResponse,
} from "@workspace/api-zod";
import { approvedAdminEmails, isAdministrator, requireAdmin } from "../middlewares/security";
import { getCatalog, saveCatalogProduct } from "../lib/catalog";
import { getShopifyStorefrontConfig } from "../lib/shopifyStorefrontClient";
import { readSettings, writeSettings } from "../lib/store-settings";
import { readiness } from "../lib/cart";
import { HttpError } from "../lib/errors";
import { listOrders } from "../lib/orders";
import { paymentConfiguration } from "../lib/myfatoorah";

const router = Router();
router.use("/admin", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/admin/me", async (req, res): Promise<void> => {
  res.json(GetAdminSessionResponse.parse({ isAdmin: await isAdministrator(req), setupRequired: !approvedAdminEmails().length }));
});
router.use("/admin", requireAdmin);
router.get("/admin/orders", async (req, res): Promise<void> => {
  const { after } = ListAdminOrdersQueryParams.parse(req.query);
  res.json(ListAdminOrdersResponse.parse(await listOrders(after)));
});
router.get("/admin/summary", async (_req, res): Promise<void> => {
  const [inquiries, products, ready, config] = await Promise.all([
    getInquiryCounts(),
    getCatalog(true), readiness(), getShopifyStorefrontConfig(),
  ]);
  res.json(GetAdminSummaryResponse.parse({
    inquiryCount: inquiries.total, newInquiryCount: inquiries.fresh,
    lowStock: products.filter(p => p.stock <= p.lowStockThreshold),
    shopAdminUrl: `https://${config.shopDomain}/admin`, shopCurrency: ready.shopCurrency,
    checkoutEnabled: ready.checkoutReady,
    notices: [
      ...(ready.launchMessage ? [ready.launchMessage] : []),
      "New orders and verified MyFatoorah payments are managed in Amore Cookies. Shopify remains the catalog and stock source. / تُدار الطلبات الجديدة ومدفوعات ماي فاتورة المؤكدة داخل أموري؛ المنتجات والمخزون مرتبطان بـShopify.",
      "Stock starts at zero until approved quantities are entered. / يبدأ المخزون بصفر حتى إدخال الكميات الفعلية.",
      ...paymentConfiguration().missing.map(key => `Payment setup required: ${key}`),
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
  if (input.checkoutEnabled) {
    const ready = await readiness();
    if (!paymentConfiguration().ready) throw new HttpError(409, "Approve and configure the live MyFatoorah account, fees and delivery before enabling checkout. / يجب اعتماد وإعداد حساب ماي فاتورة الحقيقي والرسوم والتوصيل أولاً.");
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
export default router;
