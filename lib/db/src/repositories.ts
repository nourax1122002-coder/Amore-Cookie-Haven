import type { CustomerOrder, InquiryRecord, StoreSettingsRecord } from "./schema";
import { fromDatabaseRow, supabase, toDatabaseRow, unwrap } from "./supabase";

function mapOrder(value: Record<string, unknown>) {
  return fromDatabaseRow<CustomerOrder>(value);
}

export async function getCustomerOrder(id: string) {
  const result = await supabase.from("customer_orders").select("*").eq("id", id).maybeSingle();
  const row = unwrap(result, "order read");
  return row ? mapOrder(row as Record<string, unknown>) : undefined;
}

export async function getCustomerOrderByNumber(number: string) {
  const result = await supabase.from("customer_orders").select("*").eq("number", number).maybeSingle();
  const row = unwrap(result, "order lookup");
  return row ? mapOrder(row as Record<string, unknown>) : undefined;
}

export async function getCustomerOrderByRequestKey(requestKey: string) {
  const result = await supabase.from("customer_orders").select("*").eq("request_key", requestKey).maybeSingle();
  const row = unwrap(result, "order request lookup");
  return row ? mapOrder(row as Record<string, unknown>) : undefined;
}

export async function getLatestOrderForCart(cartHash: string) {
  const result = await supabase.from("customer_orders").select("*").eq("cart_hash", cartHash)
    .order("created_at", { ascending: false }).limit(1);
  const rows = unwrap(result, "cart order lookup");
  return rows[0] ? mapOrder(rows[0] as Record<string, unknown>) : undefined;
}

type NewCustomerOrder = Pick<CustomerOrder,
  "id" | "number" | "cartHash" | "requestKey" | "requestHash" | "tokenHash" |
  "phone" | "address" | "note" | "items" | "subtotalFils" | "shippingFils" | "totalFils" | "expiresAt"
> & Partial<CustomerOrder>;

export async function insertCustomerOrder(order: NewCustomerOrder) {
  const result = await supabase.from("customer_orders").insert(toDatabaseRow(order as unknown as Record<string, unknown>))
    .select("*").single();
  return mapOrder(unwrap(result, "order insert") as Record<string, unknown>);
}

export async function updateCustomerOrder(
  id: string,
  changes: Partial<CustomerOrder>,
  expected: Partial<CustomerOrder> = {},
  notPaid = false,
) {
  let request = supabase.from("customer_orders").update(toDatabaseRow(changes as Record<string, unknown>)).eq("id", id);
  for (const [key, value] of Object.entries(expected)) {
    const column = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    request = request.eq(column, value);
  }
  if (notPaid) request = request.neq("payment_status", "paid");
  const result = await request.select("*").maybeSingle();
  const row = unwrap(result, "order update");
  return row ? mapOrder(row as Record<string, unknown>) : undefined;
}

export async function listCustomerOrders(limit = 100) {
  const result = await supabase.from("customer_orders").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  return (unwrap(result, "order list") as Record<string, unknown>[]).map(mapOrder);
}

export async function deleteCustomerOrders(ids: string[]) {
  if (!ids.length) return;
  unwrap(await supabase.from("customer_orders").delete().in("id", ids), "test order cleanup");
}

export async function listOrdersForReconciliation(paymentStatuses: string[], stockStatuses: string[], limit = 10) {
  const result = await supabase.from("customer_orders").select("id")
    .in("payment_status", paymentStatuses).in("stock_status", stockStatuses)
    .order("updated_at", { ascending: true }).limit(limit);
  return unwrap(result, "reconciliation queue") as { id: string }[];
}

export async function createInquiry(input: Pick<InquiryRecord,
  "cafeName" | "contactName" | "phone" | "email" | "area" | "products" | "notes" | "requestKey" | "requestHash"
> & Partial<InquiryRecord>) {
  const result = await supabase.from("cafe_inquiries")
    .upsert(toDatabaseRow(input as unknown as Record<string, unknown>), { onConflict: "request_key", ignoreDuplicates: true })
    .select("*").maybeSingle();
  let row = unwrap(result, "inquiry insert");
  if (!row) {
    const existing = await supabase.from("cafe_inquiries").select("*").eq("request_key", input.requestKey).maybeSingle();
    row = unwrap(existing, "inquiry lookup");
  }
  return row ? fromDatabaseRow<InquiryRecord>(row as Record<string, unknown>) : undefined;
}

export async function getInquiryCounts() {
  const [all, fresh] = await Promise.all([
    supabase.from("cafe_inquiries").select("id", { count: "exact", head: true }),
    supabase.from("cafe_inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);
  unwrap(all, "inquiry count");
  unwrap(fresh, "new inquiry count");
  return { total: all.count ?? 0, fresh: fresh.count ?? 0 };
}

export async function listInquiries(limit = 500) {
  const result = await supabase.from("cafe_inquiries").select("*").order("created_at", { ascending: false }).limit(limit);
  return (unwrap(result, "inquiry list") as Record<string, unknown>[]).map(row => fromDatabaseRow<InquiryRecord>(row));
}

export async function updateInquiry(id: number, changes: Partial<InquiryRecord>) {
  const result = await supabase.from("cafe_inquiries").update(toDatabaseRow(changes as Record<string, unknown>))
    .eq("id", id).select("*").maybeSingle();
  const row = unwrap(result, "inquiry update");
  return row ? fromDatabaseRow<InquiryRecord>(row as Record<string, unknown>) : undefined;
}

export async function readSettingsRow() {
  const result = await supabase.from("store_settings").select("*").eq("id", "amore").maybeSingle();
  const row = unwrap(result, "settings read");
  return row ? fromDatabaseRow<StoreSettingsRecord>(row as Record<string, unknown>) : undefined;
}

export async function writeSettingsRow(content: Record<string, unknown>) {
  const result = await supabase.from("store_settings")
    .upsert({ id: "amore", content, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("*").single();
  return fromDatabaseRow<StoreSettingsRecord>(unwrap(result, "settings write") as Record<string, unknown>);
}

export async function incrementSecurityCounter(scope: string, keyHash: string, windowMs: number, cap: number) {
  const result = await supabase.rpc("increment_security_counter", {
    p_scope: scope, p_key_hash: keyHash, p_window_ms: windowMs, p_cap: cap,
  });
  const rows = unwrap(result, "security counter increment") as { hits: number; expires_at: string }[];
  const row = rows[0];
  if (!row) throw new Error("Supabase returned no security counter.");
  return { totalHits: Number(row.hits), resetTime: new Date(row.expires_at) };
}

export async function deleteSecurityCounter(scope: string, keyHash: string) {
  unwrap(await supabase.rpc("delete_security_counter", { p_scope: scope, p_key_hash: keyHash }), "security counter delete");
}

export async function pruneSecurityCounters() {
  unwrap(await supabase.rpc("prune_security_counters"), "security counter cleanup");
}

export async function readActiveSecurityCounter(scope: string, keyHash: string) {
  const rows = unwrap(await supabase.rpc("read_active_security_counter", { p_scope: scope, p_key_hash: keyHash }), "security counter read") as { expires_at: string }[];
  return rows[0] ? new Date(rows[0].expires_at) : undefined;
}

export async function claimSecurityLease(scope: string, keyHash: string, token: number, seconds: number) {
  return unwrap(await supabase.rpc("claim_security_lease", {
    p_scope: scope, p_key_hash: keyHash, p_token: token, p_ttl_seconds: seconds,
  }), "security lease claim") === true;
}

export async function releaseSecurityLease(scope: string, keyHash: string, token: number) {
  unwrap(await supabase.rpc("release_security_lease", { p_scope: scope, p_key_hash: keyHash, p_token: token }), "security lease release");
}

export async function setSecurityCooldown(scope: string, keyHash: string, seconds: number) {
  unwrap(await supabase.rpc("set_security_cooldown", { p_scope: scope, p_key_hash: keyHash, p_ttl_seconds: seconds }), "security cooldown");
}

export async function acquireNamedLock(name: string, owner: string, leaseMs: number) {
  return unwrap(await supabase.rpc("acquire_named_lock", {
    p_name: name, p_owner: owner, p_lease_ms: leaseMs,
  }), "lock acquisition") === true;
}

export async function renewNamedLock(name: string, owner: string, leaseMs: number) {
  return unwrap(await supabase.rpc("renew_named_lock", {
    p_name: name, p_owner: owner, p_lease_ms: leaseMs,
  }), "lock renewal") === true;
}

export async function releaseNamedLock(name: string, owner: string) {
  unwrap(await supabase.rpc("release_named_lock", { p_name: name, p_owner: owner }), "lock release");
}

