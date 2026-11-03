// No database connection is permitted in the HTTP security suite. This fake is
// only for HTTP boundary regressions; real atomic SQL is tested separately.
const counters = new Map<string, { hits: number; expires_at: Date }>();
let failedScope: string | null = null;
export function failCounters(scope: string | null) { failedScope = scope; }
export const pool = {
  async query({ text, values }: { text: string; values: unknown[] }) {
    if (!text.includes("INSERT INTO security_counters")) throw new Error("Unexpected SQL");
    const [scope, hash, windowMs, cap] = values;
    if (failedScope === "all" || scope === failedScope) throw new Error("Fictional counter store failure");
    const key = `${scope}:${hash}`;
    let row = counters.get(key);
    if (!row || row.expires_at.getTime() <= Date.now()) {
      row = { hits: 0, expires_at: new Date(Date.now() + Number(windowMs)) };
      counters.set(key, row);
    }
    row.hits = Math.min(row.hits + 1, Number(cap));
    return { rows: [{ ...row }] };
  },
};

export const db = new Proxy({}, {
  get() { throw new Error("Unexpected database access in order HTTP tests"); },
});
export const inquiriesTable = {};
export const storeSettingsTable = {};
