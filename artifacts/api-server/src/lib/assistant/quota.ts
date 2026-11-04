import { createHmac, randomInt } from "node:crypto";
import { pool } from "@workspace/db";
import { ipKeyGenerator, type Options } from "express-rate-limit";
import { PostgresSecurityStore } from "../tracking-limits";
import { AssistantError, tomorrowSeconds } from "./openrouter";

type Query = (text: string, values: unknown[]) => Promise<{ rows: Record<string, any>[] }>;
const query: Query = async (text, values) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const config = { text, values, query_timeout: 4000 };
  try {
    return await Promise.race([
      pool.query(config),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("quota timeout")), 5000); timer.unref(); }),
    ]);
  } finally { clearTimeout(timer); }
};
export function createAssistantQuota(execute: Query = query, prefix = "assistant") {
  function hash(key: string) {
    if (!process.env.SESSION_SECRET) throw new AssistantError("quota_store");
    return createHmac("sha256", process.env.SESSION_SECRET).update(`${prefix}:${key}`).digest("hex");
  }
  function counter(scope: string, limit: number, windowMs: number) {
    const store = new PostgresSecurityStore(`${prefix}_${scope}`, limit, execute);
    store.init({ windowMs } as Options);
    return { store, limit };
  }
  const clientMinute = counter("client_minute", 3, 60_000);
  const clientDay = counter("client_day", 10, 86400_000);
  const accountMinute = counter("account_minute", 20, 60_000);
  const accountDay = counter("account_day", 50, 86400_000);
  async function consume(c: typeof clientMinute, key: string, daily = false) {
    const result = await c.store.increment(key);
    if (result.totalHits > c.limit) throw new AssistantError(daily ? "daily_limit" : "rate_limit", 429,
      daily ? tomorrowSeconds() : Math.max(1, Math.ceil((result.resetTime.getTime() - Date.now()) / 1000)));
  }
  return {
    async acquire(ip: string): Promise<() => Promise<void>> {
      try {
        const account = hash("account");
        const cooldown = await execute("SELECT expires_at FROM security_counters WHERE scope=$1 AND key_hash=$2 AND expires_at > statement_timestamp()", [`${prefix}_cooldown`, account]);
        if (cooldown.rows[0]) {
          const seconds = Math.max(1, Math.ceil((new Date(cooldown.rows[0].expires_at).getTime() - Date.now()) / 1000));
          throw new AssistantError(seconds > 3600 ? "daily_limit" : "rate_limit", 429, seconds);
        }
        const client = ipKeyGenerator(ip);
        const date = new Date().toISOString().slice(0, 10);
        await consume(clientMinute, client);
        await consume(clientDay, `${client}:${date}`, true);
        // At most two requests across all workers; a lease expires if a worker
        // crashes. Its random ownership token prevents stale release.
        const token = randomInt(1, 2_000_000_000);
        let slot: string | undefined;
        for (let i = 0; i < 2; i++) {
          const key = hash(`slot:${i}`);
          const result = await execute(`INSERT INTO security_counters(scope,key_hash,hits,expires_at)
            VALUES($1,$2,$3,statement_timestamp()+interval '60 seconds')
            ON CONFLICT(scope,key_hash) DO UPDATE SET hits=EXCLUDED.hits,expires_at=EXCLUDED.expires_at
            WHERE security_counters.expires_at <= statement_timestamp() RETURNING key_hash`,
          [`${prefix}_lease`, key, token]);
          if (result.rows[0]) { slot = key; break; }
        }
        if (!slot) throw new AssistantError("rate_limit", 429, 10);
        const release = async () => {
          await execute("DELETE FROM security_counters WHERE scope=$1 AND key_hash=$2 AND hits=$3", [`${prefix}_lease`, slot, token]);
        };
        try {
          await consume(accountMinute, "account");
          await consume(accountDay, `account:${date}`, true);
          return release;
        } catch (error) { await release(); throw error; }
      } catch (error) {
        if (error instanceof AssistantError) throw error;
        throw new AssistantError("quota_store");
      }
    },
    async cooldown(seconds: number) {
      await execute(`INSERT INTO security_counters(scope,key_hash,hits,expires_at)
        VALUES($1,$2,1,statement_timestamp()+$3*interval '1 second')
        ON CONFLICT(scope,key_hash) DO UPDATE SET expires_at=GREATEST(security_counters.expires_at,EXCLUDED.expires_at)`,
      [`${prefix}_cooldown`, hash("account"), Math.max(1, Math.min(86400, Math.ceil(seconds)))]);
    },
  };
}
