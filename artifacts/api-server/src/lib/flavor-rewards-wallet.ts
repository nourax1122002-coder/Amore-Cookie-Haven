export type PublishedCreatorFlavor = {
  id: string;
  title: string;
  titleAr: string;
};

export type VerifiedFlavorOrderSnapshot = {
  orderReference: string;
  flavorId: string;
  eligibleOrderNumber: number | null;
  verifiedPaidAt: string | null;
  eligibleSalesFils: number;
  productRefundedFils: number;
  productDisputedFils: number;
};

export type VerifiedFlavorRewardEntry = {
  flavorId: string;
  orderReference: string;
  eligibleOrderNumber: number;
  entryType: "milestone_bonus" | "commission" | "commission_adjustment";
  amountFils: number;
};

export type CreatorFlavorTransaction = {
  orderReference: string;
  eligibleOrderNumber: number;
  paidAt: string;
  eligibleProductAmountFils: number;
  commissionFils: number;
  productRefundedFils: number;
  productDisputedFils: number;
  commissionAdjustmentFils: number;
  netCommissionFils: number;
  milestoneBonusFils: number;
};

export type CreatorFlavorPerformance = {
  flavorId: string;
  flavorTitle: string;
  flavorTitleAr: string;
  verifiedPaidOrderCount: number;
  ordersRemainingToMilestone: number;
  progressPercent: number;
  milestoneStatus: "locked" | "achieved" | "awarded";
  milestoneBonusFils: number;
  commissionEarnedFils: number;
  confirmedEarningsFils: number;
  pendingEarningsFils: null;
  transactions: CreatorFlavorTransaction[];
};

function isSafeFils(value: number, allowNegative = false): boolean {
  return Number.isSafeInteger(value) && (allowNegative || value >= 0);
}

function addSafe(left: number, right: number): number {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Flavor Rewards wallet exceeds safe integer precision.");
  }
  return Number(total);
}

/**
 * Builds a creator-facing wallet only from published-flavor paid-order
 * snapshots and the append-only, verified payment reward ledger.
 */
export function buildCreatorFlavorPerformance(
  publishedFlavors: readonly PublishedCreatorFlavor[],
  snapshots: readonly VerifiedFlavorOrderSnapshot[],
  ledgerEntries: readonly VerifiedFlavorRewardEntry[],
): CreatorFlavorPerformance[] {
  const flavors = new Map(publishedFlavors.map(flavor => [flavor.id, flavor]));
  const ordersByFlavor = new Map<string, Map<string, VerifiedFlavorOrderSnapshot>>();
  const orderNumbersByFlavor = new Map<string, Set<number>>();

  for (const snapshot of snapshots) {
    if (!flavors.has(snapshot.flavorId)) continue;
    if (!snapshot.orderReference.trim()
      || !isSafeFils(snapshot.eligibleSalesFils)
      || snapshot.eligibleSalesFils < 1
      || !isSafeFils(snapshot.productRefundedFils)
      || snapshot.productRefundedFils > snapshot.eligibleSalesFils
      || !isSafeFils(snapshot.productDisputedFils)
      || snapshot.productDisputedFils > snapshot.eligibleSalesFils) {
      throw new Error("A verified Flavor Rewards order snapshot is invalid.");
    }

    // Pending/unpaid snapshots never count toward progress or rewards.
    if (snapshot.verifiedPaidAt === null) {
      if (snapshot.eligibleOrderNumber !== null) {
        throw new Error("An unpaid Flavor Rewards order cannot have an eligible order number.");
      }
      continue;
    }
    if (!Number.isSafeInteger(Date.parse(snapshot.verifiedPaidAt))
      || !Number.isSafeInteger(snapshot.eligibleOrderNumber)
      || snapshot.eligibleOrderNumber === null
      || snapshot.eligibleOrderNumber < 1) {
      throw new Error("A paid Flavor Rewards order is missing its verified order number or date.");
    }

    const flavorOrders = ordersByFlavor.get(snapshot.flavorId) ?? new Map();
    if (flavorOrders.has(snapshot.orderReference)) {
      throw new Error("A Flavor Rewards order snapshot cannot be counted twice.");
    }
    const orderNumbers = orderNumbersByFlavor.get(snapshot.flavorId) ?? new Set<number>();
    if (orderNumbers.has(snapshot.eligibleOrderNumber)) {
      throw new Error("A Flavor Rewards eligible order number cannot be reused.");
    }
    flavorOrders.set(snapshot.orderReference, snapshot);
    orderNumbers.add(snapshot.eligibleOrderNumber);
    ordersByFlavor.set(snapshot.flavorId, flavorOrders);
    orderNumbersByFlavor.set(snapshot.flavorId, orderNumbers);
  }

  const entriesByOrder = new Map<string, VerifiedFlavorRewardEntry[]>();
  const milestoneByFlavor = new Map<string, VerifiedFlavorRewardEntry>();
  for (const entry of ledgerEntries) {
    if (!flavors.has(entry.flavorId)) continue;
    if (!isSafeFils(entry.amountFils, true) || entry.amountFils === 0) {
      throw new Error("A verified Flavor Rewards ledger entry has an invalid amount.");
    }
    const order = ordersByFlavor.get(entry.flavorId)?.get(entry.orderReference);
    if (!order || order.eligibleOrderNumber !== entry.eligibleOrderNumber) {
      throw new Error("A reward ledger entry does not match a verified paid order.");
    }

    if (entry.entryType === "milestone_bonus") {
      if (entry.eligibleOrderNumber !== 100 || entry.amountFils !== 200_000
        || milestoneByFlavor.has(entry.flavorId)) {
        throw new Error("The Flavor Rewards milestone ledger is inconsistent.");
      }
      milestoneByFlavor.set(entry.flavorId, entry);
    } else if (entry.entryType === "commission") {
      if (entry.eligibleOrderNumber < 101 || entry.amountFils < 1) {
        throw new Error("Commission ledger entries must begin at eligible order 101.");
      }
    } else if (entry.eligibleOrderNumber < 101) {
      throw new Error("Commission adjustments must belong to eligible order 101 or later.");
    }

    const orderKey = `${entry.flavorId}:${entry.orderReference}`;
    const orderEntries = entriesByOrder.get(orderKey) ?? [];
    orderEntries.push(entry);
    entriesByOrder.set(orderKey, orderEntries);
  }

  return [...flavors.values()].map(flavor => {
    const flavorOrders = [...(ordersByFlavor.get(flavor.id)?.values() ?? [])]
      .sort((left, right) => Date.parse(left.verifiedPaidAt!) - Date.parse(right.verifiedPaidAt!)
        || left.orderReference.localeCompare(right.orderReference));
    const transactions = flavorOrders.map(order => {
      const orderEntries = entriesByOrder.get(`${flavor.id}:${order.orderReference}`) ?? [];
      let commissionFils = 0;
      let commissionAdjustmentFils = 0;
      let milestoneBonusFils = 0;
      for (const entry of orderEntries) {
        if (entry.entryType === "commission") commissionFils = addSafe(commissionFils, entry.amountFils);
        if (entry.entryType === "commission_adjustment") {
          commissionAdjustmentFils = addSafe(commissionAdjustmentFils, entry.amountFils);
        }
        if (entry.entryType === "milestone_bonus") milestoneBonusFils = addSafe(milestoneBonusFils, entry.amountFils);
      }
      const netCommissionFils = addSafe(commissionFils, commissionAdjustmentFils);
      if (netCommissionFils < 0) throw new Error("A commission adjustment cannot create a negative commission.");
      return {
        orderReference: order.orderReference,
        eligibleOrderNumber: order.eligibleOrderNumber!,
        paidAt: order.verifiedPaidAt!,
        eligibleProductAmountFils: order.eligibleSalesFils,
        commissionFils,
        productRefundedFils: order.productRefundedFils,
        productDisputedFils: order.productDisputedFils,
        commissionAdjustmentFils,
        netCommissionFils,
        milestoneBonusFils,
      };
    });

    const verifiedPaidOrderCount = flavorOrders.length;
    const milestoneEntry = milestoneByFlavor.get(flavor.id);
    const milestoneBonusFils = milestoneEntry?.amountFils ?? 0;
    const commissionEarnedFils = transactions.reduce(
      (sum, transaction) => addSafe(sum, transaction.netCommissionFils),
      0,
    );
    const confirmedEarningsFils = transactions.reduce(
      (sum, transaction) => addSafe(sum, transaction.netCommissionFils + transaction.milestoneBonusFils),
      0,
    );
    if (confirmedEarningsFils < 0) {
      throw new Error("Verified Flavor Rewards earnings cannot be negative.");
    }
    const milestoneStatus = milestoneEntry
      ? "awarded"
      : verifiedPaidOrderCount >= 100 ? "achieved" : "locked";

    return {
      flavorId: flavor.id,
      flavorTitle: flavor.title,
      flavorTitleAr: flavor.titleAr,
      verifiedPaidOrderCount,
      ordersRemainingToMilestone: Math.max(0, 100 - verifiedPaidOrderCount),
      progressPercent: Math.min(100, verifiedPaidOrderCount),
      milestoneStatus,
      milestoneBonusFils,
      commissionEarnedFils,
      confirmedEarningsFils,
      // The current verified ledger has no pending-earnings entry type. Null
      // means untracked, not an invented zero balance or estimated amount.
      pendingEarningsFils: null,
      transactions,
    };
  });
}
