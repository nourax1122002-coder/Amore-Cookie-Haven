import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  CancelStripeCheckoutBody, CancelStripeCheckoutResponse, GetPaymentAvailabilityResponse,
  GetPaymentOrderResponse, ListLocalOrdersResponse, UpdateLocalOrderBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/security";
import {
  authorizedOrder, callbackResult, localOrderList, orderSummary, paymentAvailability,
  cancelStripeOrder, reconcileOrder, updateFulfillment, verifyPayment,
  digest,
} from "../lib/local-orders";
import { webhookSchema, validWebhookSignature } from "../lib/myfatoorah";
import { HttpError } from "../lib/errors";
import { cartId } from "../lib/cart";

const router = Router();
const publicLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false });
router.use("/payments", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });
router.get("/payments/availability", publicLimit, async (_req, res) => { res.json(GetPaymentAvailabilityResponse.parse(await paymentAvailability())); });
router.post("/payments/stripe/cancel", publicLimit, async (req, res) => {
  const input = CancelStripeCheckoutBody.parse(req.body);
  res.json(CancelStripeCheckoutResponse.parse(await cancelStripeOrder(input.orderId, input.token)));
});
router.get("/payments/order", publicLimit, async (req, res) => {
  const order = await authorizedOrder(String(req.query.id ?? ""), String(req.query.token ?? ""));
  if (order.paymentStatus === "paid" && cartId(req) && digest(cartId(req)!) === order.cartHash) {
    res.clearCookie("amore_cart", { path: "/api", httpOnly: true, sameSite: "lax" });
  }
  res.json(GetPaymentOrderResponse.parse(orderSummary(order)));
});
router.get("/payments/callback", publicLimit, async (req, res) => {
  const input = z.object({ order: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), paymentId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).parse(req.query);
  // An error/timeout is NOT success or failure. The receipt keeps polling the
  // saved state and reconciliation/webhook will finish the verification.
  await authorizedOrder(input.order, input.token);
  let target: string;
  try { target = await callbackResult(input.order, input.token, input.paymentId); }
  catch { target = `/payment/pending?order=${encodeURIComponent(input.order)}&token=${encodeURIComponent(input.token)}`; }
  res.redirect(303, target);
});
router.post("/payments/webhook", publicLimit, async (req, res) => {
  const body = webhookSchema.parse(req.body);
  const key = process.env.MYFATOORAH_WEBHOOK_SECRET;
  if (!key || !validWebhookSignature(body, req.get("myfatoorah-signature") ?? "", key)) throw new HttpError(401, "Invalid webhook signature.");
  const id = body.Data.Invoice.ExternalIdentifier;
  if (!id) throw new HttpError(400, "Missing order reference.");
  await verifyPayment(id, body.Data.Transaction.PaymentId);
  res.json({ ok: true });
});
router.use("/admin/local-orders", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); }, requireAdmin);
router.get("/admin/local-orders", async (_req, res) => { res.json(ListLocalOrdersResponse.parse(await localOrderList())); });
router.patch("/admin/local-orders/:id", async (req, res) => {
  await updateFulfillment(String(req.params.id), UpdateLocalOrderBody.parse(req.body).stage);
  res.json({ ok: true });
});
router.post("/admin/local-orders/:id/reconcile", async (req, res) => { await reconcileOrder(String(req.params.id)); res.json({ ok: true }); });
export default router;
