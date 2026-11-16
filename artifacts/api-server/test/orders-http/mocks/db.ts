// No database connection is permitted in the HTTP boundary suite.
const counters = new Map<string, { hits: number; expiresAt: Date }>();
let failedScope: string | null = null;
export function failCounters(scope: string | null) { failedScope = scope; }
export async function incrementSecurityCounter(scope: string, hash: string, windowMs: number, cap: number) {
  if (failedScope === "all" || scope === failedScope) throw new Error("Fictional counter store failure");
  const key = `${scope}:${hash}`;
  let row = counters.get(key);
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    row = { hits: 0, expiresAt: new Date(Date.now() + windowMs) };
    counters.set(key, row);
  }
  row.hits = Math.min(row.hits + 1, cap);
  return { totalHits: row.hits, resetTime: row.expiresAt };
}
export async function deleteSecurityCounter(scope: string, hash: string) { counters.delete(`${scope}:${hash}`); }
export async function pruneSecurityCounters() {
  for (const [key, row] of counters) if (row.expiresAt.getTime() <= Date.now()) counters.delete(key);
}
export async function readActiveSecurityCounter() { return undefined; }
export async function claimSecurityLease() { return true; }
export async function releaseSecurityLease() {}
export async function setSecurityCooldown() {}
export async function createInquiry(input: Record<string, any>) {
  return { id: 1, ...input, status: "new", createdAt: new Date() };
}
export async function getCustomerOrder() { return undefined; }
export async function getCustomerOrderByNumber() { return undefined; }
export async function getCustomerOrderByRequestKey() { return undefined; }
export async function getLatestOrderForCart() { return undefined; }
export async function insertCustomerOrder() { throw new Error("Unexpected order insert in HTTP boundary test"); }
export async function updateCustomerOrder() { return undefined; }
export async function listCustomerOrders() { return []; }
export async function listOrdersForReconciliation() { return []; }
export async function deleteCustomerOrders() {}
export async function acquireNamedLock() { return true; }
export async function renewNamedLock() { return true; }
export async function releaseNamedLock() {}
export async function readSettingsRow() { return undefined; }
export async function writeSettingsRow(content: Record<string, unknown>) { return { id: "amore", content, updatedAt: new Date() }; }
export async function getInquiryCounts() { return { total: 1, fresh: 1 }; }
export async function listInquiries() { return []; }
export async function updateInquiry() { return undefined; }
export async function getProductRowByHandle() { return undefined; }
export async function getProductRowById() { return undefined; }
export async function listProductRows() { return []; }
export async function saveProductRow() { throw new Error("Unexpected product write in orders boundary test."); }
export async function createCartRow() { throw new Error("Unexpected cart write in orders boundary test."); }
export async function getCartRow() { return undefined; }
export async function listCartItemRows() { return []; }
export async function upsertCartItemRow() { throw new Error("Unexpected cart write in orders boundary test."); }
export async function updateCartItemRow() { return undefined; }
export async function deleteCartItemRow() {}
export async function updateCartNoteRow() {}
export async function attachCartToUser() {}
export async function saveUserProfile() { throw new Error("Unexpected profile write in orders boundary test."); }
export async function createSupabaseAuthClient() { throw new Error("Unexpected Auth network request in orders boundary test."); }
export async function reserveOrderProductStock() { throw new Error("Unexpected stock reservation in orders boundary test."); }
export async function releaseOrderProductStock() { throw new Error("Unexpected stock release in orders boundary test."); }
export async function uploadProductImage() { throw new Error("Unexpected product image upload in orders boundary test."); }
export async function createSignedProductImageUpload() { throw new Error("Unexpected image signing in orders boundary test."); }
export function createSupabaseUserClient(accessToken: string) {
  const userId = accessToken.replace("fictional.jwt.for.", "");
  return {
    userId,
    from(table: string) {
      if (table !== "flavor_ideas") {
        throw new Error(`Unexpected user Supabase table ${table} in orders boundary test.`);
      }
      return new FlavorIdeasQuery(userId);
    },
  };
}
class EmptyPublishedIdeasQuery {
  select() { return this; }
  order() { return this; }
  limit() { return Promise.resolve({ data: [], error: null }); }
}

type MockFlavorIdea = Record<string, unknown> & {
  id: string;
  creator_user_id: string;
  request_key: string;
};

const flavorIdeas: MockFlavorIdea[] = [];
let nextFlavorIdeaId = 1;
export function resetMockFlavorIdeas() {
  flavorIdeas.length = 0;
  nextFlavorIdeaId = 1;
}

class FlavorIdeasQuery {
  private action: "select" | "insert" | "update" = "select";
  private filters = new Map<string, unknown>();
  private payload: Record<string, unknown> | null = null;
  private userId: string | null;
  private maxRows = Number.POSITIVE_INFINITY;

  constructor(userId: string | null) {
    this.userId = userId;
  }

  select() { return this; }
  order() { return this; }
  limit(count: number) {
    this.maxRows = count;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }
  insert(payload: Record<string, unknown>) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, unknown>) {
    this.action = "update";
    this.payload = payload;
    return this;
  }
  async maybeSingle() {
    const result = this.run();
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error };
  }
  async single() {
    const result = this.run();
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return row
      ? { data: row, error: result.error }
      : { data: null, error: result.error ?? { code: "PGRST116" } };
  }
  then<TResult1 = { data: unknown; error: { code: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { code: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private selectedRows() {
    return flavorIdeas
      .filter(row => this.matches(row))
      .slice(0, this.maxRows);
  }

  private matches(row: MockFlavorIdea) {
    if (this.userId && row.creator_user_id !== this.userId) return false;
    for (const [column, value] of this.filters) {
      if (row[column] !== value) return false;
    }
    return true;
  }

  private run(): { data: unknown; error: { code: string } | null } {
    if (this.action === "select") return { data: this.selectedRows(), error: null };
    if (this.action === "insert") {
      if (!this.payload) return { data: null, error: { code: "22023" } };
      const creatorUserId = this.payload.creator_user_id;
      const requestKey = this.payload.request_key;
      if (this.userId && creatorUserId !== this.userId) return { data: null, error: { code: "42501" } };
      if (typeof creatorUserId !== "string" || typeof requestKey !== "string") {
        return { data: null, error: { code: "22023" } };
      }
      if (flavorIdeas.some(row => row.creator_user_id === creatorUserId && row.request_key === requestKey)) {
        return { data: null, error: { code: "23505" } };
      }
      const suffix = String(nextFlavorIdeaId++).padStart(12, "0");
      const now = new Date().toISOString();
      const row = {
        ...this.payload,
        id: `00000000-0000-4000-8000-${suffix}`,
        creator_user_id: creatorUserId,
        request_key: requestKey,
        status: "draft",
        commercial_status: "not_reviewed",
        confirmed_interest_count: 0,
        created_at: now,
        updated_at: now,
        published_at: null,
      } as MockFlavorIdea;
      flavorIdeas.push(row);
      return { data: row, error: null };
    }
    return { data: null, error: { code: "22023" } };
  }
}

export const supabase = {
  from(table: string) {
    if (table === "published_flavor_ideas") return new EmptyPublishedIdeasQuery();
    if (table === "flavor_ideas") return new FlavorIdeasQuery(null);
    throw new Error(`Unexpected Supabase table ${table} in orders boundary test.`);
  },
};
const accountOrders = [
  {
    id: "00000000-0000-4000-8000-000000000031",
    userId: "visitor",
    number: "AM-ACCOUNT-VISITOR",
    paymentStatus: "paid",
    fulfillmentStatus: "preparing",
    totalFils: 12500,
    currency: "KWD",
    items: [{ title: "Chocolate cookie", quantity: 2 }],
    createdAt: new Date("2026-11-01T12:00:00.000Z"),
    phone: "FICTIONAL-ACCOUNT-PHONE",
    address: "FICTIONAL-ACCOUNT-ADDRESS",
  },
  {
    id: "00000000-0000-4000-8000-000000000032",
    userId: "another",
    number: "AM-ACCOUNT-ANOTHER",
    paymentStatus: "pending",
    fulfillmentStatus: "received",
    totalFils: 9000,
    currency: "KWD",
    items: [{ title: "Vanilla cookie", quantity: 1 }],
    createdAt: new Date("2026-11-02T12:00:00.000Z"),
    phone: "FICTIONAL-ACCOUNT-PHONE",
    address: "FICTIONAL-ACCOUNT-ADDRESS",
  },
];
export async function listAccountOrderRows(client: { userId: string }, userId: string) {
  return accountOrders.filter(order => order.userId === userId && client.userId === userId);
}
export async function listFavoriteRows() { return []; }
export async function addFavoriteRow() { throw new Error("Unexpected favorite write in guest account test."); }
export async function removeFavoriteRow() { throw new Error("Unexpected favorite delete in guest account test."); }

export { customerOrdersTable } from "../../../../../lib/db/src/schema/customer-orders";
