import { createHash, timingSafeEqual } from "node:crypto";

export function normalizeOrderNumber(value: string): string | null {
  const normalized = value.trim().normalize("NFKC").replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632));
  return /^#?[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(normalized) ? normalized : null;
}

export function normalizePhone(value: string): string | null {
  const normalized = value.normalize("NFKC")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
  if (!/^\+?[\d ()-]+$/.test(normalized)) return null;
  let digits = normalized.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 8) digits = `965${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function phoneMatches(input: string, expectedPhone: string): boolean {
  const phone = normalizePhone(input);
  const expected = normalizePhone(expectedPhone);
  if (!phone || !expected) return false;
  return timingSafeEqual(
    createHash("sha256").update(phone).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
