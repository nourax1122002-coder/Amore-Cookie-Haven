import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pruneSecurityCounters } from "../lib/tracking-limits";
import { runPaymentReconciliation } from "../lib/local-orders";
import { HttpError } from "../lib/errors";

const router = Router();

function isAuthorized(requestAuthorization: string | undefined, secret: string | undefined) {
  if (!secret || !requestAuthorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(requestAuthorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Vercel Cron calls this route once daily on Hobby. It is deliberately safe to
// run repeatedly; persistent order and security-counter state lives in Supabase.
router.get("/maintenance", async (req, res): Promise<void> => {
  if (!isAuthorized(req.get("authorization"), process.env.CRON_SECRET)) {
    throw new HttpError(401, "Unauthorized.");
  }
  res.setHeader("Cache-Control", "no-store");
  await pruneSecurityCounters();
  const paymentReconciliation = await runPaymentReconciliation();
  res.json({ ok: true, paymentReconciliation });
});

export default router;
