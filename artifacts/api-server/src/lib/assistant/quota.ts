import { createHmac, randomInt } from "node:crypto";
import {
  claimSecurityLease, deleteSecurityCounter, incrementSecurityCounter, readActiveSecurityCounter,
  releaseSecurityLease, setSecurityCooldown,
} from "@workspace/db";
import { ipKeyGenerator, type Options } from "express-rate-limit";
import { SupabaseSecurityStore, type CounterBackend } from "../tracking-limits";
import { AssistantError, tomorrowSeconds } from "./openrouter";

export type AssistantQuotaBackend = CounterBackend & {
  activeUntil(scope: string, keyHash: string): Promise<Date | undefined>;
  claimLease(scope: string, keyHash: string, token: number, seconds: number): Promise<boolean>;
  releaseLease(scope: string, keyHash: string, token: number): Promise<void>;
  cooldown(scope: string, keyHash: string, seconds: number): Promise<void>;
};

const supabaseQuota: AssistantQuotaBackend = {
  increment: incrementSecurityCounter,
  delete: deleteSecurityCounter,
  activeUntil: readActiveSecurityCounter,
  claimLease: claimSecurityLease,
  releaseLease: releaseSecurityLease,
  cooldown: setSecurityCooldown,
};
export function createAssistantQuota(backend: AssistantQuotaBackend = supabaseQuota, prefix = "assistant") {
  function hash(key: string) {
    if (!process.env.SESSION_SECRET) throw new AssistantError("quota_store");
    return createHmac("sha256", process.env.SESSION_SECRET).update(`${prefix}:${key}`).digest("hex");
  }
  function counter(scope: string, limit: number, windowMs: number) {
    const store = new SupabaseSecurityStore(`${prefix}_${scope}`, limit, backend);
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
        const cooldown = await backend.activeUntil(`${prefix}_cooldown`, account);
        if (cooldown) {
          const seconds = Math.max(1, Math.ceil((cooldown.getTime() - Date.now()) / 1000));
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
          if (await backend.claimLease(`${prefix}_lease`, key, token, 60)) { slot = key; break; }
        }
        if (!slot) throw new AssistantError("rate_limit", 429, 10);
        const release = async () => {
          await backend.releaseLease(`${prefix}_lease`, slot, token);
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
      await backend.cooldown(`${prefix}_cooldown`, hash("account"), Math.max(1, Math.min(86400, Math.ceil(seconds))));
    },
  };
}
