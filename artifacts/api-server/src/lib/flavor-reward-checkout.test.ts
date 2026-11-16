import assert from "node:assert/strict";
import test from "node:test";
import { resolveFlavorRewardProduct } from "./flavor-reward-checkout";

const catalog = [
  { variantId: "product-flavor", title: "Rose cookie", price: 10, available: true, stock: 5 },
  { variantId: "product-regular", title: "Classic cookie", price: 2, available: true, stock: 20 },
];

test("Flavor Rewards order uses the database mapping and current catalog price", () => {
  const result = resolveFlavorRewardProduct(true, "product-flavor", catalog);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.product.variantId, "product-flavor");
    assert.equal(result.product.price, 10);
  }
});

test("unpublished or unmapped flavors cannot create a payable order", () => {
  assert.deepEqual(resolveFlavorRewardProduct(false, "product-flavor", catalog), { status: "not_published" });
  assert.deepEqual(resolveFlavorRewardProduct(true, null, catalog), { status: "not_mapped" });
});

test("the server rejects a client-chosen ordinary product or unavailable flavor stock", () => {
  assert.deepEqual(resolveFlavorRewardProduct(true, "client-supplied-product", catalog), { status: "unavailable" });
  assert.deepEqual(resolveFlavorRewardProduct(true, "product-flavor", [
    { ...catalog[0], available: false, stock: 0 },
  ]), { status: "unavailable" });
});
