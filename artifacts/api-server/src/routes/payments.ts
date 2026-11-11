import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  CancelStripeCheckoutBody, CancelStripeCheckoutResponse, GetPaymentAvailabilityResponse,
  GetPaymentOrderResponse, ListLocalOrdersResponse, UpdateLocalOrderBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/security";
import {
  authorizedOrder, localOrderList, orderSummary, paymentAvailability,
  cancelStripeOrder, updateFulfillment,
  digest,
} from "../lib/local-orders";
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
router.use("/admin/local-orders", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); }, requireAdmin);
router.get("/admin/local-orders", async (_req, res) => { res.json(ListLocalOrdersResponse.parse(await localOrderList())); });
router.patch("/admin/local-orders/:id", async (req, res) => {
  await updateFulfillment(String(req.params.id), UpdateLocalOrderBody.parse(req.body).stage);
  res.json({ ok: true });
});
export default router;
