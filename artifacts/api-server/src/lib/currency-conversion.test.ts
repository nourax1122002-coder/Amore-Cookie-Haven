import assert from "node:assert/strict";
import test from "node:test";
import { createCurrencyConversionService } from "./currency-conversion";

const fixedNow = Date.parse("2026-11-07T12:00:00.000Z");
const freshExchangeUpdate = Date.parse("2026-11-07T00:02:31.000Z");
const kwdRates = {
  result: "success",
  base_code: "KWD",
  time_last_update_unix: Math.floor(freshExchangeUpdate / 1000),
  rates: { KWD: 1, EUR: 2.888348, SAR: 12.08 },
};
const eurRates = { amount: 1, base: "EUR", date: "2026-11-06", rates: { USD: 1.1165, GBP: 0.83415 } };

function mockFetch(options: { kwd?: unknown; eur?: unknown; failFrankfurter?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("open.er-api.com")) return Response.json(options.kwd ?? kwdRates);
    if (options.failFrankfurter) return new Response(null, { status: 503 });
    return Response.json(options.eur ?? eurRates);
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

test("converts KWD to EUR and SAR from KWD-based rates without exposing raw rates", async () => {
  const { fetcher, calls } = mockFetch();
  const service = createCurrencyConversionService({ fetcher, now: () => fixedNow });
  const eur = await service.convert(2, "EUR");
  const sar = await service.convert(2, "SAR");
  assert.equal(eur.amount, 5.78);
  assert.equal(eur.calculation, "direct");
  assert.equal(sar.amount, 24.16);
  assert.equal(sar.sources.length, 1);
  assert.equal("rates" in eur, false);
  assert.equal(calls.length, 1, "the KWD rate response is cached for at least 24 hours");
});

test("converts USD and GBP through the KWD-to-EUR cross-rate", async () => {
  const { fetcher, calls } = mockFetch();
  const service = createCurrencyConversionService({ fetcher, now: () => fixedNow });
  const usd = await service.convert(1, "USD");
  const gbp = await service.convert(1, "GBP");
  assert.equal(usd.amount, 3.22);
  assert.equal(gbp.amount, 2.41);
  assert.equal(usd.calculation, "eur_cross_rate");
  assert.deepEqual(usd.sources.map(source => source.name), ["ExchangeRate-API", "Frankfurter"]);
  assert.equal(calls.length, 2, "both provider responses are cached for at least 24 hours");
});

test("rejects stale KWD-base rate data rather than returning a fabricated conversion", async () => {
  const { fetcher } = mockFetch({ kwd: { ...kwdRates, time_last_update_unix: 1 } });
  const service = createCurrencyConversionService({ fetcher, now: () => fixedNow });
  await assert.rejects(service.convert(1, "EUR"), /stale or missing/);
});

test("rejects stale or unavailable Frankfurter data for EUR cross-rates", async () => {
  const staleFrankfurter = { ...eurRates, date: "2026-01-01" };
  const stale = createCurrencyConversionService({
    fetcher: mockFetch({ eur: staleFrankfurter }).fetcher,
    now: () => fixedNow,
  });
  await assert.rejects(stale.convert(1, "USD"), /stale or invalid/);

  const unavailable = createCurrencyConversionService({
    fetcher: mockFetch({ failFrankfurter: true }).fetcher,
    now: () => fixedNow,
  });
  await assert.rejects(unavailable.convert(1, "GBP"), /unsuccessful response/);
});

test("does not keep cached rates after their freshness limit", async () => {
  let clock = fixedNow;
  const { fetcher, calls } = mockFetch();
  const service = createCurrencyConversionService({ fetcher, now: () => clock });
  await service.convert(1, "EUR");
  clock = freshExchangeUpdate + 97 * 60 * 60 * 1000;
  await assert.rejects(service.convert(1, "EUR"), /stale or missing/);
  assert.equal(calls.length, 2, "expired-freshness cache entries trigger a provider refresh");
});

test("accepts live ExchangeRate-API and Frankfurter response formats", async () => {
  const { fetcher } = mockFetch();
  const service = createCurrencyConversionService({ fetcher, now: () => fixedNow });
  for (const currency of ["USD", "EUR", "GBP", "SAR"] as const) {
    const result = await service.convert(1.25, currency);
    assert.ok(Number.isFinite(result.amount) && result.amount > 0);
    assert.equal(result.currency, currency);
    assert.equal(result.informationalOnly, true);
    assert.ok(result.sources.every(source => /^\d{4}-\d{2}-\d{2}$/.test(source.date)));
  }
});
