import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFlavorOrderAllowed,
  reconcileFlavorRewards,
  type FlavorPaymentEvent,
  type FlavorRewardLedgerEntry,
} from "./flavor-rewards-accounting";

const flavorId = "flavor-rose";
const creatorUserId = "creator-1";

function paidOrder(index: number, overrides: Partial<Extract<FlavorPaymentEvent, { type: "payment_succeeded" }>> = {}) {
  const id = String(index).padStart(3, "0");
  return {
    eventId: `evt-payment-${id}`,
    occurredAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    verified: true as const,
    livemode: false as const,
    type: "payment_succeeded" as const,
    orderId: `order-${id}`,
    paymentIntentId: `pi-test-${id}`,
    flavorId,
    creatorUserId,
    customerUserId: `customer-${id}`,
    sessionStatus: "complete" as const,
    paymentStatus: "paid" as const,
    currency: "usd" as const,
    expectedAmountMinor: 1000,
    actualAmountMinor: 1000,
    eligibleNetSalesFils: 10_000,
    ...overrides,
  };
}

function refundOrder(index: number, cumulativeEligibleRefundFils: number, eventId = `evt-refund-${index}`) {
  const id = String(index).padStart(3, "0");
  return {
    eventId,
    occurredAt: new Date(Date.UTC(2026, 0, 2) + index * 1000).toISOString(),
    verified: true as const,
    livemode: false as const,
    type: "refund_updated" as const,
    orderId: `order-${id}`,
    paymentIntentId: `pi-test-${id}`,
    cumulativeEligibleRefundFils,
  };
}

function chargebackOrder(
  index: number,
  status: "open" | "won" | "lost",
  eventId: string,
  eligibleDisputedFils = 10_000,
) {
  const id = String(index).padStart(3, "0");
  return {
    eventId,
    occurredAt: new Date(Date.UTC(2026, 0, 3) + index * 1000).toISOString(),
    verified: true as const,
    livemode: false as const,
    type: "chargeback_updated" as const,
    orderId: `order-${id}`,
    paymentIntentId: `pi-test-${id}`,
    disputeId: `dp-test-${id}`,
    status,
    eligibleDisputedFils,
  };
}

function sumForTarget(entries: readonly FlavorRewardLedgerEntry[], targetKey: string) {
  return entries.filter(entry => entry.targetKey === targetKey).reduce((sum, entry) => sum + entry.amountFils, 0);
}

test("99 verified eligible payments create neither milestone nor commission", () => {
  const result = reconcileFlavorRewards(Array.from({ length: 99 }, (_, index) => paidOrder(index + 1)));
  assert.equal(result.summaries[0]?.verifiedEligibleOrderCount, 99);
  assert.deepEqual(result.ledgerEntries, []);
});

test("the 100th eligible paid order creates one 200 KWD bonus and no commission", () => {
  const result = reconcileFlavorRewards(Array.from({ length: 100 }, (_, index) => paidOrder(index + 1)));
  assert.deepEqual(result.ledgerEntries.map(entry => [entry.type, entry.amountFils]), [["milestone_bonus", 200_000]]);
});

test("order 101 adds 15 percent commission only for order 101", () => {
  const result = reconcileFlavorRewards(Array.from({ length: 101 }, (_, index) => paidOrder(index + 1)));
  assert.equal(result.ledgerEntries.length, 2);
  assert.equal(sumForTarget(result.ledgerEntries, `milestone:${flavorId}`), 200_000);
  assert.equal(sumForTarget(result.ledgerEntries, "commission:order-100"), 0);
  assert.equal(sumForTarget(result.ledgerEntries, "commission:order-101"), 1_500);
});

test("order 102 adds a second commission without duplicating the milestone", () => {
  const result = reconcileFlavorRewards(Array.from({ length: 102 }, (_, index) => paidOrder(index + 1)));
  assert.equal(result.ledgerEntries.length, 3);
  assert.equal(sumForTarget(result.ledgerEntries, `milestone:${flavorId}`), 200_000);
  assert.equal(sumForTarget(result.ledgerEntries, "commission:order-101"), 1_500);
  assert.equal(sumForTarget(result.ledgerEntries, "commission:order-102"), 1_500);
});

test("replaying payment events is idempotent", () => {
  const events = Array.from({ length: 101 }, (_, index) => paidOrder(index + 1));
  const first = reconcileFlavorRewards([...events, events[100]!]);
  const replay = reconcileFlavorRewards([...events, events[100]!], first.ledgerEntries);
  assert.equal(first.summaries[0]?.verifiedEligibleOrderCount, 101);
  assert.deepEqual(replay.ledgerEntries, []);
  assert.deepEqual(
    reconcileFlavorRewards([...events, events[100]!]).ledgerEntries.map(entry => entry.idempotencyKey),
    first.ledgerEntries.map(entry => entry.idempotencyKey),
  );
});

test("two verified event types for the same Stripe payment count as one order", () => {
  const payments = Array.from({ length: 100 }, (_, index) => paidOrder(index + 1));
  const duplicatePaymentObject = {
    ...payments[99]!,
    eventId: "evt-payment-confirmation-alias",
    occurredAt: "2026-01-01T00:02:00.000Z",
  };
  const result = reconcileFlavorRewards([...payments, duplicatePaymentObject]);
  assert.equal(result.summaries[0]?.verifiedEligibleOrderCount, 100);
  assert.deepEqual(result.ledgerEntries.map(entry => entry.type), ["milestone_bonus"]);
});

test("failed and cancelled attempts do not create eligible orders or rewards", () => {
  const failed: FlavorPaymentEvent = {
    eventId: "evt-failed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    verified: true,
    livemode: false,
    type: "payment_failed",
    orderId: "order-failed",
    paymentIntentId: "pi-failed",
  };
  const cancelled: FlavorPaymentEvent = {
    eventId: "evt-cancelled",
    occurredAt: "2026-01-01T00:00:01.000Z",
    verified: true,
    livemode: false,
    type: "payment_cancelled",
    orderId: "order-cancelled",
    paymentIntentId: "pi-cancelled",
  };
  assert.deepEqual(reconcileFlavorRewards([failed, cancelled]), { summaries: [], ledgerEntries: [] });
  assert.doesNotThrow(() => assertFlavorOrderAllowed([failed, cancelled], "customer-1", flavorId));
});

test("one customer cannot use a second flavor order; regular store orders remain unrestricted", () => {
  const first = paidOrder(1, { customerUserId: "same-customer" });
  assert.throws(() => assertFlavorOrderAllowed([first], "same-customer", flavorId), /already used/i);
  assert.doesNotThrow(() => assertFlavorOrderAllowed([first], "same-customer", null));
});

test("a full refund removes the order from the milestone count and appends a reversal", () => {
  const payments = Array.from({ length: 100 }, (_, index) => paidOrder(index + 1));
  const earned = reconcileFlavorRewards(payments);
  const corrected = reconcileFlavorRewards(
    [...payments, refundOrder(100, 10_000)],
    earned.ledgerEntries,
  );
  assert.equal(corrected.summaries[0]?.verifiedEligibleOrderCount, 99);
  assert.equal(corrected.ledgerEntries.length, 1);
  assert.equal(corrected.ledgerEntries[0]?.type, "correction");
  assert.equal(corrected.ledgerEntries[0]?.amountFils, -200_000);
  assert.equal(corrected.ledgerEntries[0]?.reason, "refund_or_dispute_adjustment");
});

test("a partial refund appends only the commission reduction", () => {
  const payments = Array.from({ length: 101 }, (_, index) => paidOrder(index + 1));
  const earned = reconcileFlavorRewards(payments);
  const corrected = reconcileFlavorRewards(
    [...payments, refundOrder(101, 4_000)],
    earned.ledgerEntries,
  );
  assert.equal(sumForTarget(corrected.ledgerEntries, "commission:order-101"), -600);
  assert.ok(corrected.ledgerEntries.every(entry => entry.type === "correction"));
});

test("duplicate cumulative refund events do not create duplicate corrections", () => {
  const payments = Array.from({ length: 101 }, (_, index) => paidOrder(index + 1));
  const earned = reconcileFlavorRewards(payments);
  const refund = refundOrder(101, 4_000);
  const correction = reconcileFlavorRewards([...payments, refund], earned.ledgerEntries);
  const replay = reconcileFlavorRewards([...payments, refund, refund], [
    ...earned.ledgerEntries,
    ...correction.ledgerEntries,
  ]);
  assert.equal(correction.ledgerEntries.length, 1);
  assert.deepEqual(replay.ledgerEntries, []);
});

test("open chargebacks reverse the commission and a won dispute restores it as a correction", () => {
  const payments = Array.from({ length: 101 }, (_, index) => paidOrder(index + 1));
  const earned = reconcileFlavorRewards(payments);
  const opened = reconcileFlavorRewards(
    [...payments, chargebackOrder(101, "open", "evt-dispute-open")],
    earned.ledgerEntries,
  );
  assert.equal(opened.ledgerEntries.length, 1);
  assert.equal(opened.ledgerEntries[0]?.amountFils, -1_500);
  const won = reconcileFlavorRewards(
    [...payments, chargebackOrder(101, "open", "evt-dispute-open"), chargebackOrder(101, "won", "evt-dispute-won")],
    [...earned.ledgerEntries, ...opened.ledgerEntries],
  );
  assert.equal(won.ledgerEntries.length, 1);
  assert.equal(won.ledgerEntries[0]?.type, "correction");
  assert.equal(won.ledgerEntries[0]?.amountFils, 1_500);
});

test("live mode, unpaid sessions, and amount mismatches fail closed", () => {
  assert.throws(() => reconcileFlavorRewards([{
    ...paidOrder(1),
    livemode: true,
  } as unknown as FlavorPaymentEvent]), /Test Mode/i);
  assert.throws(() => reconcileFlavorRewards([{
    ...paidOrder(1),
    actualAmountMinor: 999,
  }]), /does not match/i);
});

test("a refunded payment still consumes that customer's one-order opportunity", () => {
  const first = paidOrder(1, { customerUserId: "same-customer" });
  assert.throws(() => assertFlavorOrderAllowed(
    [first, refundOrder(1, 10_000)],
    "same-customer",
    flavorId,
  ), /already used/i);
});
