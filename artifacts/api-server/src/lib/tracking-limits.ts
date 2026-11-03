import { createHmac } from "node:crypto";
import type { ErrorRequestHandler } from "express";
import rateLimit, { type Options, type Store } from "express-rate-limit";
import { pool } from "@workspace/db";
import { normalizeOrderNumber } from "./orders";

export type CounterQuery = (text: string, values: unknown[]) =>
  Promise<{ rows: Record<string, unknown>[] }>;

const query: CounterQuery = (text, values) => {
  const config = { text, values, query_timeout: 4000 };
  return pool.query(config);
};

// Bound pool acquisition as well as query execution. A late query can only
// consume an extra attempt, never allow a request through after the deadline.
async function boundedQuery(execute: CounterQuery, text: string, values: unknown[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execute(text, values),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Security counter timeout")), 5000);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class PostgresSecurityStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 0;

  constructor(
    private readonly scope: string,
    private readonly limit: number,
    private readonly execute: CounterQuery = query,
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
    const result = await boundedQuery(this.execute, `
      INSERT INTO security_counters (scope, key_hash, hits, expires_at)
      VALUES ($1, $2, 1, statement_timestamp() + $3 * interval '1 millisecond')
      ON CONFLICT (scope, key_hash) DO UPDATE SET
        hits = CASE WHEN security_counters.expires_at <= statement_timestamp()
          THEN 1 ELSE LEAST(security_counters.hits + 1, $4) END,
        expires_at = CASE WHEN security_counters.expires_at <= statement_timestamp()
          THEN EXCLUDED.expires_at ELSE security_counters.expires_at END
      RETURNING hits, expires_at
    `, [this.scope, this.hash(key), this.windowMs, this.limit + 1]);
    const row = result.rows[0];
    const totalHits = Number(row?.hits);
    const resetTime = row?.expires_at instanceof Date
      ? row.expires_at : new Date(String(row?.expires_at));
    if (!Number.isInteger(totalHits) || totalHits < 1 || !Number.isFinite(resetTime.getTime())) {
      throw new Error("Invalid security counter result");
    }
    return { totalHits, resetTime };
  }

  // All attempts count, including successful, invalid and failed lookups.
  async decrement(_key: string) {}

  async resetKey(key: string) {
    await boundedQuery(this.execute,
      "DELETE FROM security_counters WHERE scope = $1 AND key_hash = $2",
      [this.scope, this.hash(key)]);
  }
}

export async function pruneSecurityCounters(execute: CounterQuery = query) {
  // Recheck expiry on the DELETE itself: another replica may have just renewed
  // a selected key. No unexpired counter can be removed by the janitor.
  await boundedQuery(execute, `
    DELETE FROM security_counters
    WHERE (scope, key_hash) IN (
      SELECT scope, key_hash FROM security_counters
      WHERE expires_at <= statement_timestamp()
      ORDER BY expires_at LIMIT 10000
    ) AND expires_at <= statement_timestamp()
  `, []);
}

export function createTrackingLimits(execute: CounterQuery = query, namespace = "tracking") {
  const common = {
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    passOnStoreError: false,
    message: { error: "Too many tracking attempts. Try later. / محاولات تتبع كثيرة. يرجى المحاولة لاحقاً." },
  };
  return [
    rateLimit({
      ...common, windowMs: 15 * 60_000, limit: 10,
      store: new PostgresSecurityStore(`${namespace}:ip`, 10, execute),
      // Keep express-rate-limit's default IP validation and IPv6 /56 grouping.
    }),
    rateLimit({
      ...common, windowMs: 60 * 60_000, limit: 20,
      store: new PostgresSecurityStore(`${namespace}:order`, 20, execute),
      keyGenerator: req =>
        (normalizeOrderNumber(String(req.body?.orderNumber ?? "")) ?? "invalid").replace(/^#/, ""),
    }),
  ];
}

export const trackingStoreUnavailable: ErrorRequestHandler = (_err, req, res, _next) => {
  // This handler sits immediately after the limiters, before Shopify work.
  // Do not log DB errors: drivers can include SQL parameters in their messages.
  req.log.error({ errorType: "TrackingSecurityStoreUnavailable" }, "Tracking temporarily unavailable");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", "60");
  res.status(503).json({ error: "Tracking is temporarily unavailable. Please try again later. / التتبع غير متاح مؤقتاً. يرجى المحاولة لاحقاً." });
};
