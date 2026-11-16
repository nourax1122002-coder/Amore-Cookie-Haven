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
    eligibleNetSalesFils: number;
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
    cumulativeEligibleRefundFils: number;
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
    eligibleDisputedFils: number;
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
  eligibleNetSalesFils: number;
  refundedFils: number;
  disputes: Map<string, { status: "open" | "won" | "lost"; amountFils: number }>;
};

export type FlavorRewardSummary = {
  flavorId: string;
  verifiedEligibleOrderCount: number;
  effectiveNetSalesFils: number;
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
  latestEventByFlavor: Map<string, string>;
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
  const latestEventByFlavor = new Map<string, string>();

  for (const event of orderedEvents) {
    if (event.type === "payment_succeeded") {
      if (!event.flavorId.trim() || !event.creatorUserId.trim() || !event.customerUserId.trim()
        || event.sessionStatus !== "complete" || event.paymentStatus !== "paid"
        || event.currency !== "usd" || !isFils(event.expectedAmountMinor)
        || event.expectedAmountMinor < 1 || event.actualAmountMinor !== event.expectedAmountMinor
        || !isFils(event.eligibleNetSalesFils) || event.eligibleNetSalesFils < 1) {
        throw new Error("The verified payment does not match its eligible flavor order.");
      }
      const existing = orders.get(event.orderId);
      if (existing) {
        if (existing.paymentIntentId !== event.paymentIntentId
          || existing.flavorId !== event.flavorId
          || existing.customerUserId !== event.customerUserId) {
          throw new Error("A payment order cannot change its verified payment or flavor identity.");
        }
      } else {
        orders.set(event.orderId, {
          orderId: event.orderId,
          paymentIntentId: event.paymentIntentId,
          flavorId: event.flavorId,
          creatorUserId: event.creatorUserId,
          customerUserId: event.customerUserId,
          paidAt: event.occurredAt,
          eligibleNetSalesFils: event.eligibleNetSalesFils,
          refundedFils: 0,
          disputes: new Map(),
        });
      }
      latestEventByFlavor.set(event.flavorId, event.eventId);
      continue;
    }

    const order = orders.get(event.orderId);
    if (!order || order.paymentIntentId !== event.paymentIntentId) continue;

    if (event.type === "refund_updated") {
      if (!isFils(event.cumulativeEligibleRefundFils)
        || event.cumulativeEligibleRefundFils > order.eligibleNetSalesFils) {
        throw new Error("A verified refund exceeds the eligible flavor net sales.");
      }
      order.refundedFils = Math.max(order.refundedFils, event.cumulativeEligibleRefundFils);
      latestEventByFlavor.set(order.flavorId, event.eventId);
    } else if (event.type === "chargeback_updated") {
      if (!event.disputeId.trim() || !isFils(event.eligibleDisputedFils)
        || event.eligibleDisputedFils > order.eligibleNetSalesFils) {
        throw new Error("A verified chargeback amount is invalid.");
      }
      order.disputes.set(event.disputeId, {
        status: event.status,
        amountFils: event.eligibleDisputedFils,
      });
      latestEventByFlavor.set(order.flavorId, event.eventId);
    }
    // Failed/cancelled events intentionally never create or remove a paid order.
  }

  return { orders: [...orders.values()], latestEventByFlavor };
}

function effectiveNet(order: PaymentOrder): number {
  const disputed = [...order.disputes.values()]
    .filter(dispute => dispute.status === "open" || dispute.status === "lost")
    .reduce((sum, dispute) => sum + dispute.amountFils, 0);
  return Math.max(0, order.eligibleNetSalesFils - order.refundedFils - disputed);
}

/**
 * A customer who has ever had a verified successful payment for a flavor has
 * used that flavor's one-order opportunity, even if that payment was refunded.
 * Failed and cancelled attempts do not consume it.
 */
export function assertFlavorOrderAllowed(
  events: readonly FlavorPaymentEvent[],
  customerUserId: string,
  flavorId: string | null,
): void {
  if (!flavorId) return; // Regular Amore shopping is deliberately unrestricted.
  const { orders } = collectOrders(events);
  if (orders.some(order => order.customerUserId === customerUserId && order.flavorId === flavorId)) {
    throw new Error("This customer has already used their eligible order for this flavor.");
  }
}

/**
 * Recalculates target earnings from verified Test Mode event history and
 * returns append-only signed corrections; it never deletes financial history.
 */
export function reconcileFlavorRewards(
  events: readonly FlavorPaymentEvent[],
  existingLedger: readonly FlavorRewardLedgerEntry[] = [],
): FlavorRewardReconciliation {
  const { orders, latestEventByFlavor } = collectOrders(events);

  const firstOrderByCustomer = new Map<string, PaymentOrder>();
  for (const order of orders.sort((left, right) =>
    Date.parse(left.paidAt) - Date.parse(right.paidAt)
      || left.orderId.localeCompare(right.orderId))) {
    const key = `${order.flavorId}:${order.customerUserId}`;
    if (!firstOrderByCustomer.has(key)) firstOrderByCustomer.set(key, order);
  }
  const eligibleFirstOrders = [...firstOrderByCustomer.values()];
  const eligibleByFlavor = new Map<string, PaymentOrder[]>();
  for (const order of eligibleFirstOrders) {
    const net = effectiveNet(order);
    if (net < 1) continue;
    const list = eligibleByFlavor.get(order.flavorId) ?? [];
    list.push(order);
    eligibleByFlavor.set(order.flavorId, list);
  }

  const desired = new Map<string, {
    targetKey: string;
    flavorId: string;
    orderId: string | null;
    type: "milestone_bonus" | "commission";
    amountFils: number;
    reason: "paid_order_milestone" | "eligible_order_101_plus";
  }>();
  const summaries: FlavorRewardSummary[] = [];

  for (const [flavorId, flavorOrders] of eligibleByFlavor) {
    flavorOrders.sort((left, right) =>
      Date.parse(left.paidAt) - Date.parse(right.paidAt)
        || left.orderId.localeCompare(right.orderId));
    const effectiveNetSalesFils = flavorOrders.reduce((sum, order) => sum + effectiveNet(order), 0);
    summaries.push({
      flavorId,
      verifiedEligibleOrderCount: flavorOrders.length,
      effectiveNetSalesFils,
    });

    const milestoneKey = `milestone:${flavorId}`;
    const existingMilestone = existingLedger.filter(entry => entry.targetKey === milestoneKey);
    const milestoneWasEverGranted = existingMilestone.some(entry =>
      entry.type === "milestone_bonus" && entry.amountFils > 0);
    const milestoneBalance = existingMilestone.reduce((sum, entry) => sum + entry.amountFils, 0);
    const milestoneTarget = flavorOrders.length >= 100
      ? (milestoneWasEverGranted ? milestoneBalance : 200_000)
      : (milestoneWasEverGranted ? 0 : milestoneBalance);
    if (milestoneTarget !== 0) {
      desired.set(milestoneKey, {
        targetKey: milestoneKey,
        flavorId,
        orderId: null,
        type: "milestone_bonus",
        amountFils: milestoneTarget,
        reason: "paid_order_milestone",
      });
    }

    flavorOrders.forEach((order, index) => {
      if (index < 100) return;
      const targetKey = `commission:${order.orderId}`;
      desired.set(targetKey, {
        targetKey,
        flavorId,
        orderId: order.orderId,
        type: "commission",
        amountFils: commissionFils(effectiveNet(order)),
        reason: "eligible_order_101_plus",
      });
    });
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
    const previousAmount = oldEntries.reduce((sum, entry) => sum + entry.amountFils, 0);
    const target = desired.get(targetKey);
    const targetAmount = target?.amountFils ?? 0;
    const delta = targetAmount - previousAmount;
    if (!delta) continue;

    const flavorId = target?.flavorId ?? oldEntries[0]?.flavorId;
    if (!flavorId) continue;
    const sourceEventId = latestEventByFlavor.get(flavorId)
      ?? newestEventById.find(event => event.type === "payment_succeeded" && event.flavorId === flavorId)?.eventId
      ?? "reconciliation";
    const reason = target?.reason ?? "refund_or_dispute_adjustment";
    entries.push({
      idempotencyKey: `flavor-reward:${sourceEventId}:${targetKey}:${delta}`,
      targetKey,
      flavorId,
      orderId: target?.orderId ?? oldEntries[0]?.orderId ?? null,
      type: delta > 0 ? (target?.type ?? "correction") : "correction",
      amountFils: delta,
      sourceEventId,
      reason,
    });
  }

  summaries.sort((left, right) => left.flavorId.localeCompare(right.flavorId));
  entries.sort((left, right) => left.targetKey.localeCompare(right.targetKey));
  return { summaries, ledgerEntries: entries };
}
