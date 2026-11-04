import { Router } from "express";
import rateLimit from "express-rate-limit";
import { SendAssistantMessageBody, SendAssistantMessageResponse, GetAssistantStatusResponse } from "@workspace/api-zod";
import { getCatalog } from "../lib/catalog";
import { readiness } from "../lib/cart";
import { AssistantError, createOpenRouter, validatePrivateInput } from "../lib/assistant/openrouter";
import { createAssistantQuota } from "../lib/assistant/quota";

const router = Router();
const gateway = createOpenRouter();
const quota = createAssistantQuota();
const statusLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "يرجى الانتظار قليلاً قبل إعادة المحاولة.", code: "rate_limit", retryAfterSeconds: 60 } });
router.get("/assistant/status", statusLimit, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(GetAssistantStatusResponse.parse({ enabled: Boolean(process.env.OPENROUTER_API_KEY), dailyLimit: 50, perMinuteLimit: 20 }));
});
function publicText(value: unknown) {
  return String(value ?? "").replace(/(?:\+?\d[\s()-]*){7,}|https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[محذوف]").slice(0, 1000);
}
async function publicContext(signal: AbortSignal) {
  const work = Promise.all([getCatalog(), readiness()]).then(([catalog, store]) => JSON.stringify({
    store: "Amore Cookies — أموري كوكيز، عجينة كوكيز مفرزنة جاهزة للخبز، الكويت",
    products: catalog.slice(0, 12).map(p => ({ name: publicText(p.titleAr || p.title),
      description: publicText(p.descriptionAr || p.description), pieces: p.pieces,
      // No stock counts, customer/order/cart content or payment information.
    })),
    baking: publicText(JSON.stringify(store.settings.bakingSteps)),
    storage: publicText(store.settings.storageAr),
  }));
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      listener = () => reject(new AssistantError("cancelled", 499));
      if (signal.aborted) listener(); else signal.addEventListener("abort", listener, { once: true });
    })]);
  } finally { if (listener) signal.removeEventListener("abort", listener); }
}
router.post("/assistant/chat", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const controller = new AbortController();
  const close = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", close);
  const deadline = setTimeout(() => controller.abort(), 45_000);
  let release: (() => Promise<void>) | undefined;
  try {
    if (!process.env.OPENROUTER_API_KEY) throw new AssistantError("configuration");
    const parsed = SendAssistantMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "اكتبي رسالة قصيرة، ولا تتجاوزي طول المحادثة المسموح.", code: "validation" }); return;
    }
    const { messages } = parsed.data;
    if (messages.reduce((n, m) => n + m.content.length, 0) > 6000 || messages.at(-1)?.role !== "user"
      || messages.some((m, i) => m.role !== (i % 2 ? "assistant" : "user") || !m.content.trim())) {
      res.status(400).json({ error: "تعذّر قراءة المحادثة. امسحي المحادثة وابدئي برسالة قصيرة.", code: "validation" }); return;
    }
    messages.forEach(m => validatePrivateInput(m.content));
    release = await quota.acquire(req.ip ?? "unknown");
    const context = await publicContext(controller.signal);
    const result = await gateway.chat(process.env.OPENROUTER_API_KEY, messages, context, controller.signal);
    if (!controller.signal.aborted) res.json(SendAssistantMessageResponse.parse(result));
  } catch (error) {
    let failure = error instanceof AssistantError ? error : new AssistantError("network");
    req.log.warn({ assistantCode: failure.code, upstreamStage: failure.stage }, "Assistant request unavailable");
    if (controller.signal.aborted && !res.destroyed) failure = new AssistantError("timeout", 504);
    if (failure.status === 429 && failure.retryAfterSeconds) {
      // Per-client quotas do not block all visitors; only upstream throttles
      // are shared. acquire errors are caught before release is assigned.
      if (release) await quota.cooldown(failure.retryAfterSeconds).catch(() => {});
      res.setHeader("Retry-After", failure.retryAfterSeconds);
    }
    if (!res.destroyed && !res.headersSent) res.status(failure.status === 499 ? 503 : failure.status).json({
      error: failure.message, code: failure.code,
      ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    });
  } finally {
    clearTimeout(deadline); res.off("close", close);
    if (release) await release().catch(() => {});
  }
});
export default router;
