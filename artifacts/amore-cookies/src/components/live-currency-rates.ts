export const LIVE_CURRENCY_CODES = ["USD", "EUR", "GBP", "SAR"] as const;
export type LiveCurrencyCode = (typeof LIVE_CURRENCY_CODES)[number];

export type LiveCurrencyRate = {
  quote: LiveCurrencyCode;
  rate: number;
  date: string;
};

export type ParsedLiveCurrencyRates = {
  rates: Partial<Record<LiveCurrencyCode, LiveCurrencyRate>>;
  latestDate: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRateDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function parseLiveCurrencyRates(payload: unknown): ParsedLiveCurrencyRates {
  if (!Array.isArray(payload)) throw new Error("Frankfurter V2 returned an invalid rates response.");

  const rates: Partial<Record<LiveCurrencyCode, LiveCurrencyRate>> = {};
  for (const row of payload) {
    if (!isRecord(row) || row.base !== "KWD"
      || !LIVE_CURRENCY_CODES.includes(row.quote as LiveCurrencyCode)
      || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0
      || !isRateDate(row.date)) continue;

    const quote = row.quote as LiveCurrencyCode;
    const current = rates[quote];
    if (!current || row.date > current.date) {
      rates[quote] = { quote, rate: row.rate, date: row.date };
    }
  }

  const latestDate = Object.values(rates).reduce<string | null>((latest, item) => {
    if (!item) return latest;
    return latest === null || item.date > latest ? item.date : latest;
  }, null);

  return { rates, latestDate };
}
