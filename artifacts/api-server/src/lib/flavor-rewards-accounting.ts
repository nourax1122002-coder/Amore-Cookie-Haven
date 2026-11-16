/**
 * Pure reward accounting for a future verified Stripe webhook adapter.
 *
 * Callers must construct these normalized events only after Stripe's signature,
 * Test Mode, session/order match, and stored KWD line amounts have been checked.
 * This module deliberately does not call Stripe, Supabase, or the store checkout.
 */
export type FlavorPaymentEvent =
  | {
    eventId: string;
    occurredAt: string;
    verified: true;
    livemode: false;
    type: "payment_succeeded";
    orderId: string;
    paymentIntentId: string;
    flavorId: string;
    creatorUserId: string;
    customerUserId: string;
    sessionStatus: "complete";
    paymentStatus: "paid";
    currency: "usd";
    expectedAmountMinor: number;
    actualAmountMinor: number;
    eligibleProductNetSalesFils: number;
  }
  | {
    eventId: string;
    occurredAt: string;
    verified: true;
    livemode: false;
    type: "payment_failed" | "payment_cancelled";
    orderId: string;
    paymentIntentId: string;
  }
  | {
    eventId: string;
    occurredAt: string;
    verified: true;
    livemode: false;
    type: "refund_updated";
    orderId: string;
    paymentIntentId: string;
    cumulativeProductRefundFils: number;
  }
  | {
    eventId: string;
    occurredAt: string;
    verified: true;
    livemode: false;
    type: "chargeback_updated";
    orderId: string;
    paymentIntentId: string;
    disputeId: string;
    status: "open" | "won" | "lost";
    eligibleProductDisputedFils: number;
  };

export type FlavorRewardLedgerEntry = {
  idempotencyKey: string;
  targetKey: string;
  flavorId: string;
  orderId: string | null;
  type: "milestone_bonus" | "commission" | "correction";
  amountFils: number;
  sourceEventId: string;
  reason: "paid_order_milestone" | "eligible_order_101_plus" | "refund_or_dispute_adjustment";
};

type PaymentOrder = {
  orderId: string;
  paymentIntentId: string;
  flavorId: string;
  creatorUserId: string;
  customerUserId: string;
  paidAt: string;
  paymentEventId: string;
  eligibleOrderNumber: number | null;
  eligibleProductNetSalesFils: number;
  refundedFils: number;
  disputes: Map<string, { status: "open" | "won" | "lost"; amountFils: number }>;
};

export type FlavorRewardSummary = {
  flavorId: string;
  verifiedEligibleOrderCount: number;
  effectiveProductNetSalesFils: number;
  milestoneEarned: boolean;
};

export type FlavorRewardReconciliation = {
  summaries: FlavorRewardSummary[];
  ledgerEntries: FlavorRewardLedgerEntry[];
};

function isFils(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertEventEnvelope(event: FlavorPaymentEvent): void {
  if (!event.verified || event.livemode !== false || !event.eventId.trim()
    || !Number.isFinite(Date.parse(event.occurredAt))
    || !event.orderId.trim() || !event.paymentIntentId.trim()) {
    throw new Error("Only verified Stripe Test Mode events can affect Flavor Rewards.");
  }
}

function commissionFils(netSalesFils: number): number {
  return Number((BigInt(netSalesFils) * 15n + 50n) / 100n);
}

function collectOrders(events: readonly FlavorPaymentEvent[]): {
  orders: PaymentOrder[];
  milestoneEventByFlavor: Map<string, string>;
  latestEventByOrder: Map<string, string>;
} {
  const uniqueEvents = new Map<string, FlavorPaymentEvent>();
  for (const event of events) {
    assertEventEnvelope(event);
    const previous = uniqueEvents.get(event.eventId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) {
      throw new Error("A Stripe event ID cannot be reused for different event data.");
    }
    uniqueEvents.set(event.eventId, event);
  }

  const orderedEvents = [...uniqueEvents.values()].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
      || left.eventId.localeCompare(right.eventId));
  const orders = new Map<string, PaymentOrder>();
  const nextEligibleOrderNumberByFlavor = new Map<string, number>();
  const eligibleOrderCountByFlavor = new Map<string, number>();
  const milestoneEventByFlavor = new Map<string, string>();
  const latestEventByOrder = new Map<string, string>();

  const recordMilestoneIfReached = (flavorId: string, eventId: string) => {
    if ((eligibleOrderCountByFlavor.get(flavorId) ?? 0) >= 100
      && !milestoneEventByFlavor.has(flavorId)) {
      milestoneEventByFlavor.set(flavorId, eventId);
    }
  };

  for (const event of orderedEvents) {
    if (event.type === "payment_succeeded") {
      if (!event.flavorId.trim() || !event.creatorUserId.trim() || !event.customerUserId.trim()
        || event.sessionStatus !== "complete" || event.paymentStatus !== "paid"
        || event.currency !== "usd" || !isFils(event.expectedAmountMinor)
        || event.expectedAmountMinor < 1 || event.actualAmountMinor !== event.expectedAmountMinor
        || !isFils(event.eligibleProductNetSalesFils)
        || event.eligibleProductNetSalesFils < 1) {
        throw new Error("The verified payment does not match its eligible flavor order.");
      }
      const existing = orders.get(event.orderId);
      if (existing) {
        if (existing.paymentIntentId !== event.paymentIntentId
          || existing.flavorId !== event.flavorId
          || existing.creatorUserId !== event.creatorUserId
          || existing.customerUserId !== event.customerUserId
          || existing.eligibleProductNetSalesFils !== event.eligibleProductNetSalesFils) {
          throw new Error("A payment order cannot change its verified payment or flavor identity.");
        }
      } else {
        const eligibleOrderNumber = (nextEligibleOrderNumberByFlavor.get(event.flavorId) ?? 0) + 1;
        nextEligibleOrderNumberByFlavor.set(event.flavorId, eligibleOrderNumber);
        eligibleOrderCountByFlavor.set(
          event.flavorId,
          (eligibleOrderCountByFlavor.get(event.flavorId) ?? 0) + 1,
        );
        orders.set(event.orderId, {
          orderId: event.orderId,
          paymentIntentId: event.paymentIntentId,
          flavorId: event.flavorId,
          creatorUserId: event.creatorUserId,
          customerUserId: event.customerUserId,
          paidAt: event.occurredAt,
          paymentEventId: event.eventId,
          eligibleOrderNumber,
          eligibleProductNetSalesFils: event.eligibleProductNetSalesFils,
          refundedFils: 0,
          disputes: new Map(),
        });
        latestEventByOrder.set(event.orderId, event.eventId);
        recordMilestoneIfReached(event.flavorId, event.eventId);
        continue;
      }
      latestEventByOrder.set(event.orderId, event.eventId);
      continue;
    }

    const order = orders.get(event.orderId);
    if (!order || order.paymentIntentId !== event.paymentIntentId) continue;

    const wasEligible = effectiveNet(order) > 0;
    if (event.type === "refund_updated") {
      if (!isFils(event.cumulativeProductRefundFils)
        || event.cumulativeProductRefundFils > order.eligibleProductNetSalesFils) {
        throw new Error("A verified product refund exceeds the eligible flavor sales.");
      }
      order.refundedFils = Math.max(order.refundedFils, event.cumulativeProductRefundFils);
      latestEventByOrder.set(order.orderId, event.eventId);
    } else if (event.type === "chargeback_updated") {
      if (!event.disputeId.trim() || !isFils(event.eligibleProductDisputedFils)
        || event.eligibleProductDisputedFils > order.eligibleProductNetSalesFils) {
        throw new Error("A verified chargeback amount is invalid.");
      }
      order.disputes.set(event.disputeId, {
        status: event.status,
        amountFils: event.eligibleProductDisputedFils,
      });
    }
    const isEligible = effectiveNet(order) > 0;
    if (wasEligible !== isEligible) {
      const currentCount = eligibleOrderCountByFlavor.get(order.flavorId) ?? 0;
      eligibleOrderCountByFlavor.set(order.flavorId, currentCount + (isEligible ? 1 : -1));
    }
    latestEventByOrder.set(order.orderId, event.eventId);
    recordMilestoneIfReached(order.flavorId, event.eventId);
    // Failed/cancelled events intentionally never create or remove a paid order.
  }

  return { orders: [...orders.values()], milestoneEventByFlavor, latestEventByOrder };
}

function effectiveNet(order: PaymentOrder): number {
  const disputed = [...order.disputes.values()]
    .filter(dispute => dispute.status === "open" || dispute.status === "lost")
    .reduce((sum, dispute) => sum + BigInt(dispute.amountFils), 0n);
  const net = BigInt(order.eligibleProductNetSalesFils) - BigInt(order.refundedFils) - disputed;
  return net > 0n ? Number(net) : 0;
}

/**
 * Recalculates target earnings from verified Test Mode event history and
 * returns append-only signed commission corrections. A granted milestone is
 * immutable; inconsistent legacy milestone adjustments fail closed for review.
 */
export function reconcileFlavorRewards(
  events: readonly FlavorPaymentEvent[],
  existingLedger: readonly FlavorRewardLedgerEntry[] = [],
): FlavorRewardReconciliation {
  for (const entry of existingLedger) {
    if (!entry.targetKey.trim() || !entry.flavorId.trim() || !Number.isSafeInteger(entry.amountFils)) {
      throw new Error("Existing reward ledger entries must have stable keys and integer fils.");
    }
  }
  const { orders, milestoneEventByFlavor, latestEventByOrder } = collectOrders(events);
  const ordersByFlavor = new Map<string, PaymentOrder[]>();
  for (const order of orders) {
    const list = ordersByFlavor.get(order.flavorId) ?? [];
    list.push(order);
    ordersByFlavor.set(order.flavorId, list);
  }

  const desired = new Map<string, {
    targetKey: string;
    flavorId: string;
    orderId: string | null;
    type: "milestone_bonus" | "commission";
    amountFils: number;
    reason: "paid_order_milestone" | "eligible_order_101_plus";
    sourceEventId: string;
  }>();
  const summaries: FlavorRewardSummary[] = [];

  const flavorIds = new Set([
    ...ordersByFlavor.keys(),
    ...milestoneEventByFlavor.keys(),
    ...existingLedger.map(entry => entry.flavorId),
  ]);

  for (const flavorId of flavorIds) {
    const flavorOrders = (ordersByFlavor.get(flavorId) ?? []).sort((left, right) =>
      (left.eligibleOrderNumber ?? Number.MAX_SAFE_INTEGER)
        - (right.eligibleOrderNumber ?? Number.MAX_SAFE_INTEGER)
        || Date.parse(left.paidAt) - Date.parse(right.paidAt)
        || left.orderId.localeCompare(right.orderId));
    const activeOrders = flavorOrders.filter(order => effectiveNet(order) > 0);
    const effectiveNetSales = activeOrders.reduce((sum, order) => sum + BigInt(effectiveNet(order)), 0n);
    if (effectiveNetSales > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Flavor reward sales exceed safe integer precision.");
    }
    const effectiveProductNetSalesFils = Number(effectiveNetSales);
    summaries.push({
      flavorId,
      verifiedEligibleOrderCount: activeOrders.length,
      effectiveProductNetSalesFils,
      milestoneEarned: false,
    });

    const milestoneKey = `milestone:${flavorId}`;
    const existingMilestone = existingLedger.filter(entry => entry.targetKey === milestoneKey);
    const positiveMilestoneAwards = existingMilestone.filter(entry =>
      entry.type === "milestone_bonus" && entry.amountFils > 0);
    if (positiveMilestoneAwards.length > 1
      || positiveMilestoneAwards.some(entry => entry.amountFils !== 200_000)
      || existingMilestone.some(entry => entry.type !== "milestone_bonus" || entry.amountFils !== 200_000)) {
      throw new Error("Existing milestone history is inconsistent and requires review.");
    }
    const milestoneWasEverGranted = positiveMilestoneAwards.length === 1;
    const milestoneWasReached = milestoneEventByFlavor.has(flavorId)
      || activeOrders.length >= 100
      || milestoneWasEverGranted;
    const summary = summaries[summaries.length - 1]!;
    summary.milestoneEarned = milestoneWasReached;
    if (milestoneWasReached) {
      desired.set(milestoneKey, {
        targetKey: milestoneKey,
        flavorId,
        orderId: null,
        type: "milestone_bonus",
        amountFils: 200_000,
        reason: "paid_order_milestone",
        sourceEventId: milestoneEventByFlavor.get(flavorId)
          ?? positiveMilestoneAwards[0]?.sourceEventId
          ?? "reconciliation",
      });
    }

    for (const order of flavorOrders) {
      if (order.eligibleOrderNumber === null || order.eligibleOrderNumber <= 100) continue;
      const targetKey = `commission:${order.orderId}`;
      desired.set(targetKey, {
        targetKey,
        flavorId,
        orderId: order.orderId,
        type: "commission",
        amountFils: commissionFils(effectiveNet(order)),
        reason: "eligible_order_101_plus",
        sourceEventId: latestEventByOrder.get(order.orderId) ?? order.paymentEventId,
      });
    }
  }

  const ledgerByTarget = new Map<string, FlavorRewardLedgerEntry[]>();
  for (const entry of existingLedger) {
    const list = ledgerByTarget.get(entry.targetKey) ?? [];
    list.push(entry);
    ledgerByTarget.set(entry.targetKey, list);
  }
  const keys = new Set([...ledgerByTarget.keys(), ...desired.keys()]);
  const newestEventById = [...events].sort((left, right) =>
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || right.eventId.localeCompare(left.eventId));
  const entries: FlavorRewardLedgerEntry[] = [];

  for (const targetKey of keys) {
    const oldEntries = ledgerByTarget.get(targetKey) ?? [];
    const previousAmountBig = oldEntries.reduce((sum, entry) => sum + BigInt(entry.amountFils), 0n);
    if (previousAmountBig > BigInt(Number.MAX_SAFE_INTEGER)
      || previousAmountBig < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error("Existing reward ledger balance exceeds safe integer precision.");
    }
    const previousAmount = Number(previousAmountBig);
    const target = desired.get(targetKey);
    const targetAmount = target?.amountFils ?? 0;
    const delta = targetAmount - previousAmount;
    if (!delta) continue;

    const flavorId = target?.flavorId ?? oldEntries[0]?.flavorId;
    if (!flavorId) continue;
    if (targetKey === `milestone:${flavorId}` && (delta < 0 || oldEntries.length > 0)) {
      throw new Error("A milestone bonus cannot be reversed, deducted, or awarded twice.");
    }
    const sourceEventId = target?.sourceEventId
      ?? newestEventById.find(event => event.type === "payment_succeeded" && event.flavorId === flavorId)?.eventId
      ?? "reconciliation";
    const reason = target
      ? (delta > 0 && oldEntries.length === 0
        ? target.reason
        : targetKey === `milestone:${flavorId}`
        ? "paid_order_milestone"
        : "refund_or_dispute_adjustment")
      : "refund_or_dispute_adjustment";
    entries.push({
      idempotencyKey: `flavor-reward:${sourceEventId}:${targetKey}`,
      targetKey,
      flavorId,
      orderId: target?.orderId ?? oldEntries[0]?.orderId ?? null,
      type: delta > 0 && oldEntries.length === 0 ? (target?.type ?? "correction") : "correction",
      amountFils: delta,
      sourceEventId,
      reason,
    });
  }

  summaries.sort((left, right) => left.flavorId.localeCompare(right.flavorId));
  entries.sort((left, right) => left.targetKey.localeCompare(right.targetKey));
  return { summaries, ledgerEntries: entries };
}
