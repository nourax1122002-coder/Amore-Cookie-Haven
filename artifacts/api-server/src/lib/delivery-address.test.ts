import assert from "node:assert/strict";
import test from "node:test";
import { checkoutAddress } from "./delivery-address";

const address = { area: " Salmiya ", block: "2", street: "3", house: "4" };

test("checkout accepts and normalizes an address without map coordinates", () => {
  assert.deepEqual(checkoutAddress(address), {
    area: "Salmiya",
    block: "2",
    street: "3",
    house: "4",
  });
});

test("checkout retains valid coordinates when a caller provides them", () => {
  const location = { latitude: 29.3759, longitude: 47.9774 };
  assert.deepEqual(checkoutAddress({ ...address, location }), {
    area: "Salmiya",
    block: "2",
    street: "3",
    house: "4",
    location,
  });
});

test("checkout rejects malformed coordinates and incomplete addresses", () => {
  for (const location of [
    null,
    {},
    { latitude: 91, longitude: 48 },
    { latitude: 29, longitude: 181 },
    { latitude: Number.NaN, longitude: 48 },
  ]) {
    assert.throws(() => checkoutAddress({ ...address, location }));
  }
  assert.throws(() => checkoutAddress({ ...address, area: " " }));
});
