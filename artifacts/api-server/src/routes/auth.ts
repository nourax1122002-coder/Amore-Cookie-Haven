import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { attachCartToUser } from "@workspace/db";
import { getAuthenticatedUser, establishSession, signInWithPassword, signOutSession, signUpWithPassword } from "../lib/auth";
import { cartId } from "../lib/cart";

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
const accountLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait before trying again. / محاولات كثيرة. يرجى الانتظار قبل المحاولة مجدداً." },
});

router.use("/auth", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

router.get("/auth/session", async (req, res): Promise<void> => {
  res.json({ user: await getAuthenticatedUser(req, res) });
});

router.post("/auth/sign-up", accountLimit, async (req, res): Promise<void> => {
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
