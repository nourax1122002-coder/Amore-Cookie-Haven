const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/KWD";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,GBP";
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_CACHE_MS = DAY_MS;
const MAX_RATE_AGE_MS = 96 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const EXCHANGE_RATE_ATTRIBUTION = {
  name: "ExchangeRate-API",
  url: "https://www.exchangerate-api.com",
};
const FRANKFURTER_ATTRIBUTION = {
  name: "Frankfurter",
  url: "https://www.frankfurter.app",
};

type ExchangeRateData = {
  date: string;
  updatedAt: number;
  rates: { EUR: number; SAR: number };
};
type FrankfurterData = {
  date: string;
  updatedAt: number;
  rates: { USD: number; GBP: number };
};
type SourceAttribution = { name: string; url: string; date: string };
type TargetCurrency = "USD" | "EUR" | "GBP" | "SAR";
type ConversionResult = {
  amount: number;
  currency: TargetCurrency;
  calculation: "direct" | "eur_cross_rate";
  sources: SourceAttribution[];
  informationalOnly: true;
};
type FetchLike = typeof fetch;
type ConversionServiceOptions = { fetcher?: FetchLike; now?: () => number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validDate(value: unknown, now: number): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000 && now - timestamp <= MAX_RATE_AGE_MS;
}

async function getJson(fetcher: FetchLike, url: string): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error("Rate provider returned an unsuccessful response.");
  return response.json();
}

function parseExchangeRateData(value: unknown, now: number): ExchangeRateData {
  if (!isRecord(value) || value.result !== "success" || value.base_code !== "KWD"
    || typeof value.time_last_update_unix !== "number" || !Number.isFinite(value.time_last_update_unix)
    || !isRecord(value.rates)) {
    throw new Error("ExchangeRate-API response was invalid.");
  }
  const updateTime = value.time_last_update_unix * 1000;
  const eur = value.rates.EUR;
  const sar = value.rates.SAR;
  if (updateTime > now + 5 * 60_000 || now - updateTime > MAX_RATE_AGE_MS
    || !positiveRate(eur) || !positiveRate(sar)) {
    throw new Error("ExchangeRate-API data is stale or missing required currencies.");
  }
  return {
    date: new Date(updateTime).toISOString().slice(0, 10),
    updatedAt: updateTime,
    rates: { EUR: eur, SAR: sar },
  };
}

function parseFrankfurterData(value: unknown, now: number): FrankfurterData {
  if (!isRecord(value) || value.base !== "EUR" || !validDate(value.date, now) || !isRecord(value.rates)
    || !positiveRate(value.rates.USD) || !positiveRate(value.rates.GBP)) {
    throw new Error("Frankfurter response was stale or invalid.");
  }
  return {
    date: value.date,
    updatedAt: Date.parse(`${value.date}T00:00:00.000Z`),
    rates: { USD: value.rates.USD, GBP: value.rates.GBP },
  };
}

export function createCurrencyConversionService(options: ConversionServiceOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let exchangeRateCache: { value: ExchangeRateData; expiresAt: number } | undefined;
  let exchangeRatePending: Promise<ExchangeRateData> | undefined;
  let frankfurterCache: { value: FrankfurterData; expiresAt: number } | undefined;
  let frankfurterPending: Promise<FrankfurterData> | undefined;

  async function getExchangeRates(): Promise<ExchangeRateData> {
    const currentTime = now();
    if (exchangeRateCache && exchangeRateCache.expiresAt > currentTime
      && currentTime - exchangeRateCache.value.updatedAt <= MAX_RATE_AGE_MS) return exchangeRateCache.value;
    exchangeRateCache = undefined;
    if (!exchangeRatePending) {
      exchangeRatePending = getJson(fetcher, EXCHANGE_RATE_URL)
        .then(data => parseExchangeRateData(data, now()))
        .then(value => {
          exchangeRateCache = { value, expiresAt: now() + RATE_CACHE_MS };
          return value;
        })
        .finally(() => { exchangeRatePending = undefined; });
    }
    return exchangeRatePending;
  }

  async function getFrankfurterRates(): Promise<FrankfurterData> {
    const currentTime = now();
    if (frankfurterCache && frankfurterCache.expiresAt > currentTime
      && currentTime - frankfurterCache.value.updatedAt <= MAX_RATE_AGE_MS) return frankfurterCache.value;
    frankfurterCache = undefined;
    if (!frankfurterPending) {
      frankfurterPending = getJson(fetcher, FRANKFURTER_URL)
        .then(data => parseFrankfurterData(data, now()))
        .then(value => {
          frankfurterCache = { value, expiresAt: now() + RATE_CACHE_MS };
          return value;
        })
        .finally(() => { frankfurterPending = undefined; });
    }
    return frankfurterPending;
  }

  return {
    async convert(amount: number, currency: TargetCurrency): Promise<ConversionResult> {
      const exchange = await getExchangeRates();
      let converted: number;
      let calculation: ConversionResult["calculation"] = "direct";
      const sources: SourceAttribution[] = [{
        ...EXCHANGE_RATE_ATTRIBUTION,
        date: exchange.date,
      }];

      if (currency === "EUR" || currency === "SAR") {
        converted = amount * exchange.rates[currency];
      } else {
        const frankfurter = await getFrankfurterRates();
        converted = amount * exchange.rates.EUR * frankfurter.rates[currency];
        calculation = "eur_cross_rate";
        sources.push({ ...FRANKFURTER_ATTRIBUTION, date: frankfurter.date });
      }

      if (!Number.isFinite(converted) || converted <= 0) throw new Error("Converted amount is invalid.");
      return {
        amount: Math.round((converted + Number.EPSILON) * 100) / 100,
        currency,
        calculation,
        sources,
        informationalOnly: true,
      };
    },
  };
}

export const currencyConversionService = createCurrencyConversionService();
