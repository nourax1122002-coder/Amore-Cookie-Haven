import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { SupabaseSecurityStore, type CounterBackend } from "./tracking-limits";

export function createAuthEmailSendLimits(backend?: CounterBackend) {
  const common = {
    windowMs: 60_000,
    limit: 1,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    passOnStoreError: false,
    message: {
      error: "An account email was just requested. Please wait before trying again. / تم طلب رسالة حساب للتو. يرجى الانتظار قبل المحاولة مجدداً.",
    },
  } as const;
  const byIp = rateLimit({
    ...common,
    store: new SupabaseSecurityStore("auth:email-send:ip", 1, backend),
  });
  const byAddress = rateLimit({
    ...common,
    store: new SupabaseSecurityStore("auth:email-send:email", 1, backend),
    keyGenerator: (req: Request) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      return `email:${email || "invalid"}`;
    },
  });
  return [byIp, byAddress] as const;
}

export const authEmailSendLimits = createAuthEmailSendLimits();
