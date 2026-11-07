import { createHmac } from "node:crypto";
import type { ErrorRequestHandler } from "express";
import rateLimit, { type Options, type Store } from "express-rate-limit";
import {
  deleteSecurityCounter, incrementSecurityCounter, pruneSecurityCounters as pruneSupabaseCounters,
} from "@workspace/db";
import { normalizeOrderNumber } from "./phone";

export type CounterBackend = {
  increment(scope: string, keyHash: string, windowMs: number, cap: number): Promise<{ totalHits: number; resetTime: Date }>;
  delete(scope: string, keyHash: string): Promise<void>;
};
const supabaseCounters: CounterBackend = {
  increment: incrementSecurityCounter,
  delete: deleteSecurityCounter,
};

export class SupabaseSecurityStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 0;

  constructor(
    private readonly scope: string,
    private readonly limit: number,
    private readonly backend: CounterBackend = supabaseCounters,
  ) {
    this.prefix = `${scope}:`;
  }

  init(options: Options) { this.windowMs = options.windowMs; }

  private hash(key: string) {
    // Stable across replicas and restarts. No unkeyed hashes of enumerable order
    // numbers/IPs, and no fallback to an ephemeral or missing secret.
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("Shared security counter secret is required");
    return createHmac("sha256", secret).update(this.prefix).update(key).digest("hex");
  }

  async increment(key: string) {
    if (!this.windowMs) throw new Error("Security store is not initialized");
    const { totalHits, resetTime } = await this.backend.increment(this.scope, this.hash(key), this.windowMs, this.limit + 1);
    if (!Number.isInteger(totalHits) || totalHits < 1 || !Number.isFinite(resetTime.getTime())) {
      throw new Error("Invalid security counter result");
    }
    return { totalHits, resetTime };
  }

  // All attempts count, including successful, invalid and failed lookups.
  async decrement(_key: string) {}

  async resetKey(key: string) {
    await this.backend.delete(this.scope, this.hash(key));
  }
}

export const PostgresSecurityStore = SupabaseSecurityStore;
export async function pruneSecurityCounters() { await pruneSupabaseCounters(); }

export function createTrackingLimits(backend: CounterBackend = supabaseCounters, namespace = "tracking") {
  const common = {
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    passOnStoreError: false,
    message: { error: "Too many tracking attempts. Try later. / محاولات تتبع كثيرة. يرجى المحاولة لاحقاً." },
  };
  return [
    rateLimit({
      ...common, windowMs: 15 * 60_000, limit: 10,
      store: new SupabaseSecurityStore(`${namespace}:ip`, 10, backend),
      // Keep express-rate-limit's default IP validation and IPv6 /56 grouping.
    }),
    rateLimit({
      ...common, windowMs: 60 * 60_000, limit: 20,
      store: new SupabaseSecurityStore(`${namespace}:order`, 20, backend),
      keyGenerator: req =>
        (normalizeOrderNumber(String(req.body?.orderNumber ?? "")) ?? "invalid").replace(/^#/, ""),
    }),
  ];
}

export const trackingStoreUnavailable: ErrorRequestHandler = (_err, req, res, _next) => {
  // This handler sits immediately after the limiters, before database lookups.
  // Do not log DB errors: drivers can include SQL parameters in their messages.
  req.log.error({ errorType: "TrackingSecurityStoreUnavailable" }, "Tracking temporarily unavailable");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", "60");
  res.status(503).json({ error: "Tracking is temporarily unavailable. Please try again later. / التتبع غير متاح مؤقتاً. يرجى المحاولة لاحقاً." });
};
