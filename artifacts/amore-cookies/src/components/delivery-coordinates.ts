export function parseCoordinate(raw: string, kind: 'lat' | 'lng'): number | null {
  const text = raw.trim()
    .replace(/[٠-٩]/g, n => String(n.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, n => String(n.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.');
  if (!text || !/^[-+]?\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text), limit = kind === 'lat' ? 90 : 180;
  return Number.isFinite(number) && number >= -limit && number <= limit ? number : null;
}
