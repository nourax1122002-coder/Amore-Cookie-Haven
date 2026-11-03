import { Router } from "express";
import { db, inquiriesTable } from "@workspace/db";
import { count, desc, eq } from "drizzle-orm";
import {
  GetAdminSessionResponse, GetAdminSummaryResponse, GetAdminSettingsResponse,
  SaveSettingsBody, SaveSettingsResponse, ListInquiriesResponse, UpdateInquiryParams,
  UpdateInquiryBody, UpdateInquiryResponse, ListAdminProductsResponse, SaveProductBody, SaveProductResponse,
} from "@workspace/api-zod";
import { approvedAdminEmails, isAdministrator, requireAdmin } from "../middlewares/security";
import { getCatalog, saveCatalogProduct } from "../lib/catalog";
import { getShopifyStorefrontConfig } from "../lib/shopifyStorefrontClient";
import { readSettings, writeSettings } from "../lib/store-settings";
import { readiness } from "../lib/cart";
import { HttpError } from "../lib/errors";

const router = Router();
router.use("/admin", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/admin/me", async (req, res): Promise<void> => {
  res.json(GetAdminSessionResponse.parse({ isAdmin: await isAdministrator(req), setupRequired: !approvedAdminEmails().length }));
});
router.use("/admin", requireAdmin);
router.get("/admin/summary", async (_req, res): Promise<void> => {
  const [totals, newOnes, products, ready, config] = await Promise.all([
    db.select({ value: count() }).from(inquiriesTable),
    db.select({ value: count() }).from(inquiriesTable).where(eq(inquiriesTable.status, "new")),
    getCatalog(true), readiness(), getShopifyStorefrontConfig(),
  ]);
  res.json(GetAdminSummaryResponse.parse({
    inquiryCount: totals[0]?.value ?? 0, newInquiryCount: newOnes[0]?.value ?? 0,
    lowStock: products.filter(p => p.stock <= p.lowStockThreshold),
    shopAdminUrl: `https://${config.shopDomain}/admin`, shopCurrency: ready.shopCurrency,
    checkoutEnabled: ready.checkoutReady,
    notices: [
      ...(ready.launchMessage ? [ready.launchMessage] : []),
      "Sales, orders, discount codes, delivery zones, shipping rates and payment providers are managed in Shopify. / تدار المبيعات والطلبات وأكواد الخصم ومناطق التوصيل ورسومه وطرق الدفع في Shopify.",
      "Stock starts at zero until approved quantities are entered. / يبدأ المخزون بصفر حتى إدخال الكميات الفعلية.",
      "Number-and-phone tracking requires order-data access. Customers can use Shopify's secure confirmation link. / التتبع برقم الطلب والهاتف يتطلب صلاحية بيانات الطلبات، ويمكن للعميل استخدام رابط تأكيد Shopify.",
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
    if (ready.shopCurrency !== "KWD") throw new HttpError(409, "Set the Shopify store currency to KWD before enabling checkout. / اضبطي عملة Shopify إلى الدينار الكويتي قبل تفعيل الشراء.");
  }
  res.json(SaveSettingsResponse.parse(await writeSettings(input)));
});
router.get("/admin/inquiries", async (_req, res): Promise<void> => {
  const rows = await db.select().from(inquiriesTable).orderBy(desc(inquiriesTable.createdAt)).limit(500);
  res.json(ListInquiriesResponse.parse(rows.map(({ requestHash: _hash, ...r }) => ({ ...r, createdAt: r.createdAt.toISOString() }))));
});
router.patch("/admin/inquiries/:id", async (req, res): Promise<void> => {
  const { id } = UpdateInquiryParams.parse(req.params);
  const data = UpdateInquiryBody.parse(req.body);
  const [row] = await db.update(inquiriesTable).set(data).where(eq(inquiriesTable.id, id)).returning();
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
