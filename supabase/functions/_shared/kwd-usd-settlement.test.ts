import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  allocateUsdLineAmounts,
  createKwdUsdRateProvider,
  convertKwdFilsToUsdMinor,
  KWD_USD_RATE_SOURCE,
} from "./kwd-usd-settlement.ts";

const fixedNow = Date.parse("2026-11-11T04:00:00.000Z");
const liveShape = {
  result: "success",
  base_code: "KWD",
  time_last_update_unix: Math.floor(Date.parse("2026-11-11T00:02:32.000Z") / 1000),
  rates: { USD: 3.221725 },
};

Deno.test("loads a fresh KWD/USD rate from the free daily provider and caches it", async () => {
  let calls = 0;
  const provider = createKwdUsdRateProvider({
    now: () => fixedNow,
    fetcher: async () => {
      calls += 1;
      return Response.json(liveShape);
    },
  });
  const first = await provider.getRate();
  const second = await provider.getRate();
  assertEquals(first, {
    rate: 3.221725,
    source: KWD_USD_RATE_SOURCE,
    updatedAt: "2026-11-11T00:02:32.000Z",
  });
  assertEquals(second, first);
  assertEquals(calls, 1);
});

Deno.test("rejects stale, malformed, or unavailable KWD/USD data", async () => {
  const stale = createKwdUsdRateProvider({
    now: () => fixedNow,
    fetcher: async () => Response.json({
      ...liveShape,
      time_last_update_unix: Math.floor(Date.parse("2026-11-01T00:00:00.000Z") / 1000),
    }),
  });
  await assertRejects(() => stale.getRate(), Error, "stale or invalid");

  const malformed = createKwdUsdRateProvider({
    now: () => fixedNow,
    fetcher: async () => Response.json({ ...liveShape, base_code: "EUR" }),
  });
  await assertRejects(() => malformed.getRate(), Error, "response was invalid");

  const unavailable = createKwdUsdRateProvider({
    now: () => fixedNow,
    fetcher: async () => new Response(null, { status: 503 }),
  });
  await assertRejects(() => unavailable.getRate(), Error, "unsuccessful response");
});

Deno.test("converts the full KWD order total into rounded USD cents", () => {
  assertEquals(convertKwdFilsToUsdMinor(13_000, 3.221725), 4_188);
  assertEquals(convertKwdFilsToUsdMinor(23_000, 3.221725), 7_410);
});

Deno.test("allocates product and delivery USD lines without changing the converted total", () => {
  const result = allocateUsdLineAmounts([
    { name: "Classic Belgian Cocoa (1 bag)", amountFils: 10_000 },
    { name: "Delivery", amountFils: 3_000 },
  ], 13_000, 3.221725);
  assertEquals(result.totalMinor, 4_188);
  assertEquals(result.lines, [
    { name: "Classic Belgian Cocoa (1 bag)", amountMinor: 3_222 },
    { name: "Delivery", amountMinor: 966 },
  ]);
  assertEquals(result.lines.reduce((sum, line) => sum + line.amountMinor, 0), 4_188);
});

Deno.test("rejects an order line allocation that differs from the KWD order total", () => {
  let caught = false;
  try {
    allocateUsdLineAmounts([{ name: "Cookie", amountFils: 10_000 }], 13_000, 3.221725);
  } catch (error) {
    caught = error instanceof Error && error.message.includes("do not match");
  }
  assertEquals(caught, true);
});
