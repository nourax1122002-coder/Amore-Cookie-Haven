import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_CURRENCY_CODES, parseLiveCurrencyRates } from "./live-currency-rates.ts";

const livePayload = [
  { date: "2026-11-11", base: "KWD", quote: "USD", rate: 3.2331 },
  { date: "2026-11-11", base: "KWD", quote: "EUR", rate: 2.8848 },
  { date: "2026-11-11", base: "KWD", quote: "GBP", rate: 2.4097 },
  { date: "2026-11-11", base: "KWD", quote: "SAR", rate: 12.124 },
];

test("parses dated KWD base rates from Frankfurter V2", () => {
  const parsed = parseLiveCurrencyRates(livePayload);
  assert.deepEqual(Object.keys(parsed.rates).sort(), [...LIVE_CURRENCY_CODES].sort());
  assert.equal(parsed.latestDate, "2026-11-11");
  assert.equal(parsed.rates.USD?.rate, 3.2331);
});

test("leaves unavailable or invalid pairs out so the UI can label them unavailable", () => {
  const parsed = parseLiveCurrencyRates([
    { date: "2026-11-11", base: "KWD", quote: "USD", rate: 3.2 },
    { date: "2026-11-11", base: "KWD", quote: "JPY", rate: 180 },
    { date: "2026-11-11", base: "KWD", quote: "SAR", rate: 0 },
  ]);
  assert.deepEqual(Object.keys(parsed.rates), ["USD"]);
  assert.equal(parsed.rates.EUR, undefined);
  assert.equal(parsed.rates.SAR, undefined);
});

test("rejects a malformed provider envelope", () => {
  assert.throws(() => parseLiveCurrencyRates({ rates: [] }), /invalid rates response/);
});
