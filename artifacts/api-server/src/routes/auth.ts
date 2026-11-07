import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { attachCartToUser } from "@workspace/db";
import {
  establishRecoverySession, getAuthenticatedUser, establishSession, requestPasswordRecovery,
  resendSignupConfirmation, signInWithPassword, signOutSession, signUpWithPassword,
  updatePasswordFromRecovery,
} from "../lib/auth";
import { cartId } from "../lib/cart";
import { SupabaseSecurityStore } from "../lib/tracking-limits";

const router = Router();
const signUpBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().max(120).default(""),
});
const signInBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});
const emailBody = z.object({ email: z.string().trim().email().max(254) });
const recoverySessionBody = z.object({
  accessToken: z.string().min(20).max(8192).refine(value => !/[\r\n]/.test(value)),
  refreshToken: z.string().min(20).max(8192).refine(value => !/[\r\n]/.test(value)),
});
const recoveryPasswordBody = z.object({ password: z.string().min(8).max(128) });
const accountLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  passOnStoreError: false,
  store: new SupabaseSecurityStore("auth:account:ip", 10),
  message: { error: "Too many attempts. Please wait before trying again. / محاولات كثيرة. يرجى الانتظار قبل المحاولة مجدداً." },
});
// A single shared email-send bucket covers sign-up, confirmation resend, and
// password recovery. The database-backed counter is HMAC-keyed, so no raw IP
// address or email is persisted and replicas cannot bypass the cooldown.
const emailSendLimit = rateLimit({
  windowMs: 60_000,
  limit: 1,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  passOnStoreError: false,
  store: new SupabaseSecurityStore("auth:email-send:ip", 1),
  message: { error: "An account email was just requested. Please wait before trying again. / تم طلب رسالة حساب للتو. يرجى الانتظار قبل المحاولة مجدداً." },
});

router.use("/auth", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

router.get("/auth/session", async (req, res): Promise<void> => {
  res.json({ user: await getAuthenticatedUser(req, res) });
});

router.post("/auth/sign-up", emailSendLimit, accountLimit, async (req, res): Promise<void> => {
  const input = signUpBody.parse(req.body);
  const origin = req.get("origin");
  const emailRedirectTo = origin ? new URL("/sign-in", origin).toString() : undefined;
  const result = await signUpWithPassword(input.email, input.password, input.displayName, emailRedirectTo);
  if (!result.session || !result.user) {
    res.status(202).json({ user: null, requiresEmailConfirmation: true });
    return;
  }
  const user = await establishSession(req, res, result.user, result.session);
  const id = cartId(req);
  if (id) await attachCartToUser(id, user.id);
  res.status(201).json({ user, requiresEmailConfirmation: false });
});

router.post("/auth/resend-confirmation", emailSendLimit, accountLimit, async (req, res): Promise<void> => {
  const input = emailBody.parse(req.body);
  const origin = req.get("origin");
  const emailRedirectTo = origin ? new URL("/sign-in", origin).toString() : undefined;
  await resendSignupConfirmation(input.email, emailRedirectTo);
  // Supabase does not disclose whether this address belongs to an account.
  res.status(202).json({ requested: true });
});

router.post("/auth/password-recovery", emailSendLimit, accountLimit, async (req, res): Promise<void> => {
  const input = emailBody.parse(req.body);
  const origin = req.get("origin");
  const redirectTo = origin ? new URL("/reset-password", origin).toString() : undefined;
  await requestPasswordRecovery(input.email, redirectTo);
  // Keep the response identical for existing and unknown addresses.
  res.status(202).json({ requested: true });
});

router.post("/auth/recovery/session", accountLimit, async (req, res): Promise<void> => {
  const input = recoverySessionBody.parse(req.body);
  await establishRecoverySession(req, res, input.accessToken, input.refreshToken);
  res.status(204).end();
});

router.post("/auth/recovery/update-password", accountLimit, async (req, res): Promise<void> => {
  const input = recoveryPasswordBody.parse(req.body);
  await updatePasswordFromRecovery(req, res, input.password);
  res.json({ updated: true });
});

router.post("/auth/sign-in", accountLimit, async (req, res): Promise<void> => {
  const input = signInBody.parse(req.body);
  const result = await signInWithPassword(input.email, input.password);
  const user = await establishSession(req, res, result.user, result.session);
  const id = cartId(req);
  if (id) await attachCartToUser(id, user.id);
  res.json({ user, requiresEmailConfirmation: false });
});

router.post("/auth/sign-out", async (req, res): Promise<void> => {
  await signOutSession(req, res);
  res.json({ user: null });
});

export default router;
