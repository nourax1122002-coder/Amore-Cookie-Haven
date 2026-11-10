export type StripeTestKeys = {
  secretKey: string;
  webhookSecret: string;
};

export function hasStripeTestKeys(keys: Pick<StripeTestKeys, "secretKey" | "webhookSecret">): boolean {
  return keys.secretKey.startsWith("sk_test_")
    && !keys.secretKey.startsWith("sk_live_")
    && keys.webhookSecret.startsWith("whsec_");
}

export function isSafeFils(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000_000;
}

export function validStoredKwdTotals(subtotalFils: unknown, shippingFils: unknown, totalFils: unknown): boolean {
  return isSafeFils(subtotalFils) && isSafeFils(shippingFils) && isSafeFils(totalFils)
    && subtotalFils + shippingFils === totalFils;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export type StripePaymentEventKind = "paid" | "failed" | "cancelled" | "refunded";

export function nextPaymentStatus(
  kind: StripePaymentEventKind,
  currentStatus: string,
  refundedAmountFils: number,
  totalFils: number,
): string {
  if (kind === "refunded") {
    if (!["paid", "partially_refunded", "refunded"].includes(currentStatus)) return currentStatus;
    return refundedAmountFils >= totalFils ? "refunded" : "partially_refunded";
  }
  if (kind === "paid") {
    return ["refunded", "partially_refunded"].includes(currentStatus) ? currentStatus : "paid";
  }
  if (["paid", "partially_refunded", "refunded"].includes(currentStatus)) return currentStatus;
  return kind;
}

export function validStripeEventMode(livemode: unknown): livemode is false {
  return livemode === false;
}
