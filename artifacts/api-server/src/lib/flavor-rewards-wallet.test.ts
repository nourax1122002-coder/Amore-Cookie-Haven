import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreatorFlavorPerformance,
  type VerifiedFlavorOrderSnapshot,
  type VerifiedFlavorRewardEntry,
} from "./flavor-rewards-wallet";

const flavor = { id: "flavor-a", title: "Rose Pistachio", titleAr: "فستق وورد" };
const order = (number: number, overrides: Partial<VerifiedFlavorOrderSnapshot> = {}): VerifiedFlavorOrderSnapshot => ({
  orderReference: `order-${number}`,
  flavorId: flavor.id,
  eligibleOrderNumber: number,
  verifiedPaidAt: new Date(Date.UTC(2026, 0, number)).toISOString(),
  eligibleSalesFils: 10_000,
  productRefundedFils: 0,
  productDisputedFils: 0,
  ...overrides,
});
const ledger = (
  number: number,
  entryType: VerifiedFlavorRewardEntry["entryType"],
  amountFils: number,
): VerifiedFlavorRewardEntry => ({
  flavorId: flavor.id,
  orderReference: `order-${number}`,
  eligibleOrderNumber: number,
  entryType,
  amountFils,
});

test("shows locked progress, remaining orders, and no invented earnings below 100", () => {
  const result = buildCreatorFlavorPerformance(
    [flavor],
    Array.from({ length: 99 }, (_, index) => order(index + 1)),
    [],
  )[0]!;

  assert.equal(result.verifiedPaidOrderCount, 99);
  assert.equal(result.ordersRemainingToMilestone, 1);
  assert.equal(result.progressPercent, 99);
  assert.equal(result.milestoneStatus, "locked");
  assert.equal(result.milestoneBonusFils, 0);
  assert.equal(result.confirmedEarningsFils, 0);
  assert.equal(result.pendingEarningsFils, null);
});

test("distinguishes achieved from awarded and makes the bonus permanent in the wallet", () => {
  const paidOrders = Array.from({ length: 100 }, (_, index) => order(index + 1));
  const achieved = buildCreatorFlavorPerformance([flavor], paidOrders, [])[0]!;
  assert.equal(achieved.milestoneStatus, "achieved");
  assert.equal(achieved.ordersRemainingToMilestone, 0);
  assert.equal(achieved.milestoneBonusFils, 0);

  const awarded = buildCreatorFlavorPerformance(
    [flavor],
    paidOrders,
    [ledger(100, "milestone_bonus", 200_000)],
  )[0]!;
  assert.equal(awarded.milestoneStatus, "awarded");
  assert.equal(awarded.milestoneBonusFils, 200_000);
  assert.equal(awarded.confirmedEarningsFils, 200_000);
});

test("uses verified ledger commissions from order 101 and separates product refunds and adjustments", () => {
  const paidOrders = Array.from({ length: 102 }, (_, index) => order(index + 1));
  paidOrders[100] = order(101, { productRefundedFils: 5_000 });
  const result = buildCreatorFlavorPerformance([flavor], paidOrders, [
    ledger(100, "milestone_bonus", 200_000),
    ledger(101, "commission", 1_500),
    ledger(101, "commission_adjustment", -750),
    ledger(102, "commission", 1_500),
  ])[0]!;

  assert.equal(result.verifiedPaidOrderCount, 102);
  assert.equal(result.ordersRemainingToMilestone, 0);
  assert.equal(result.progressPercent, 100);
  assert.equal(result.milestoneStatus, "awarded");
  assert.equal(result.commissionEarnedFils, 2_250);
  assert.equal(result.confirmedEarningsFils, 202_250);
  assert.equal(result.transactions.length, 102);
  assert.deepEqual(result.transactions.slice(0, 2).map(item => item.eligibleOrderNumber), [1, 2]);
  assert.equal(result.transactions[100]?.commissionFils, 1_500);
  assert.equal(result.transactions[100]?.productRefundedFils, 5_000);
  assert.equal(result.transactions[100]?.commissionAdjustmentFils, -750);
  assert.equal(result.transactions[100]?.netCommissionFils, 750);
  assert.equal(result.transactions[99]?.milestoneBonusFils, 200_000);
});

test("excludes unpublished flavors and unverified or ordinary store orders", () => {
  const result = buildCreatorFlavorPerformance(
    [flavor],
    [
      order(1),
      order(2, { flavorId: "unpublished-flavor" }),
      order(3, { verifiedPaidAt: null, eligibleOrderNumber: null }),
    ],
    [],
  )[0]!;

  assert.equal(result.verifiedPaidOrderCount, 1);
  assert.deepEqual(result.transactions.map(item => item.orderReference), ["order-1"]);
});

test("fails closed when a ledger entry is not backed by the matching paid order", () => {
  assert.throws(
    () => buildCreatorFlavorPerformance([flavor], [order(101)], [ledger(100, "milestone_bonus", 200_000)]),
    /does not match a verified paid order/,
  );
});

test("rejects invalid milestone or commission placements instead of displaying false balances", () => {
  assert.throws(
    () => buildCreatorFlavorPerformance(
      [flavor],
      Array.from({ length: 100 }, (_, index) => order(index + 1)),
      [ledger(100, "milestone_bonus", 100_000)],
    ),
    /milestone ledger is inconsistent/,
  );
  assert.throws(
    () => buildCreatorFlavorPerformance(
      [flavor],
      Array.from({ length: 100 }, (_, index) => order(index + 1)),
      [ledger(100, "commission", 1_500)],
    ),
    /Commission ledger entries must begin/,
  );
});
