import { isSafeFils } from "./stripe-domain.ts";

const KWD_USD_URL = "https://open.er-api.com/v6/latest/KWD";
const MAX_RATE_AGE_MS = 48 * 60 * 60 * 1000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

export const KWD_USD_RATE_SOURCE = "ExchangeRate-API";

export type KwdUsdRate = {
  rate: number;
  source: typeof KWD_USD_RATE_SOURCE;
  updatedAt: string;
};

type RateProviderOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createKwdUsdRateProvider(options: RateProviderOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { value: KwdUsdRate; timestamp: number; expiresAt: number } | undefined;
  let pending: Promise<KwdUsdRate> | undefined;

  async function fetchRate(): Promise<KwdUsdRate> {
    const response = await fetcher(KWD_USD_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("KWD/USD rate provider returned an unsuccessful response.");

    const payload: unknown = await response.json();
    const fetchedAt = now();
    if (!isRecord(payload) || payload.result !== "success" || payload.base_code !== "KWD"
      || typeof payload.time_last_update_unix !== "number" || !Number.isFinite(payload.time_last_update_unix)
      || !isRecord(payload.rates)) {
      throw new Error("KWD/USD rate provider response was invalid.");
    }
    const updatedAtMs = payload.time_last_update_unix * 1000;
    const rate = payload.rates.USD;
    if (!Number.isFinite(updatedAtMs) || updatedAtMs > fetchedAt + 5 * 60_000
      || fetchedAt - updatedAtMs > MAX_RATE_AGE_MS
      || typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.1 || rate > 10) {
      throw new Error("KWD/USD rate is stale or invalid.");
    }

    return {
      rate,
      source: KWD_USD_RATE_SOURCE,
      updatedAt: new Date(updatedAtMs).toISOString(),
    };
  }

  return {
    async getRate(): Promise<KwdUsdRate> {
      const currentTime = now();
      if (cache && cache.expiresAt > currentTime
        && currentTime - cache.timestamp <= MAX_RATE_AGE_MS) return cache.value;
      cache = undefined;
      if (!pending) {
        pending = fetchRate()
          .then(value => {
            const timestamp = Date.parse(value.updatedAt);
            cache = { value, timestamp, expiresAt: now() + CACHE_TTL_MS };
            return value;
          })
          .finally(() => { pending = undefined; });
      }
      return pending;
    },
  };
}

export function convertKwdFilsToUsdMinor(totalFils: number, rate: number): number {
  if (!isSafeFils(totalFils) || totalFils < 1 || !Number.isFinite(rate) || rate < 0.1 || rate > 10) {
    throw new Error("KWD order total or exchange rate is invalid.");
  }
  const amountMinor = Math.round(totalFils * rate / 10 + Number.EPSILON);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 2_000_000_000) {
    throw new Error("Converted USD amount is outside the supported range.");
  }
  return amountMinor;
}

export type UsdLineComponent = { name: string; amountFils: number };
export type UsdLineAmount = { name: string; amountMinor: number };

export function allocateUsdLineAmounts(
  components: UsdLineComponent[],
  totalFils: number,
  rate: number,
): { totalMinor: number; lines: UsdLineAmount[] } {
  if (!Array.isArray(components) || components.length === 0
    || components.some(component => typeof component.name !== "string" || !component.name.trim()
      || !isSafeFils(component.amountFils) || component.amountFils < 1)
    || components.reduce((sum, component) => sum + component.amountFils, 0) !== totalFils) {
    throw new Error("KWD checkout lines do not match the stored order total.");
  }

  const totalMinor = convertKwdFilsToUsdMinor(totalFils, rate);
  const converted = components.map((component, index) => {
    const exactMinor = component.amountFils * rate / 10;
    const floorMinor = Math.floor(exactMinor);
    return {
      index,
      name: component.name.trim().slice(0, 200),
      floorMinor,
      remainder: exactMinor - floorMinor,
    };
  });
  const floorTotal = converted.reduce((sum, component) => sum + component.floorMinor, 0);
  let centsToAllocate = totalMinor - floorTotal;
  if (!Number.isSafeInteger(centsToAllocate) || centsToAllocate < 0 || centsToAllocate > converted.length) {
    throw new Error("USD line allocation could not preserve the converted order total.");
  }
  for (const component of [...converted].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (centsToAllocate === 0) break;
    component.floorMinor += 1;
    centsToAllocate -= 1;
  }

  const lines = converted.map(({ name, floorMinor }) => ({ name, amountMinor: floorMinor }));
  if (lines.some(line => !Number.isSafeInteger(line.amountMinor) || line.amountMinor < 1)
    || lines.reduce((sum, line) => sum + line.amountMinor, 0) !== totalMinor) {
    throw new Error("USD line items do not match the converted order total.");
  }
  return { totalMinor, lines };
}

export const kwdUsdRateProvider = createKwdUsdRateProvider();
