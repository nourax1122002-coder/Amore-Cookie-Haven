import type { CustomerOrder, InquiryRecord, StoreSettingsRecord } from "./schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDatabaseRow, supabase, toDatabaseRow, unwrap } from "./supabase";

export type ProductRecord = {
  id: string;
  handle: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  price: string | number;
  currency: string;
  pieces: number;
  imageUrl: string;
  stock: number;
  lowStockThreshold: number;
  ingredients: string;
  ingredientsAr: string;
  isActive: boolean;
};

export type UserProfileRecord = {
  userId: string;
  email: string;
  displayName: string;
  role: "customer" | "administrator";
  createdAt: Date;
  updatedAt: Date;
};

export type CartItemRecord = {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
};

export async function listProductRows(includeInactive = false) {
  let request = supabase.from("products").select("*").order("created_at", { ascending: true });
  if (!includeInactive) request = request.eq("is_active", true);
  const rows = unwrap(await request, "product list") as Record<string, unknown>[];
  return rows.map(row => fromDatabaseRow<ProductRecord>(row));
}

export async function getProductRowByHandle(handle: string) {
  const row = unwrap(await supabase.from("products").select("*").eq("handle", handle).eq("is_active", true).maybeSingle(), "product lookup");
  return row ? fromDatabaseRow<ProductRecord>(row as Record<string, unknown>) : undefined;
}

export async function getProductRowById(id: string) {
  const row = unwrap(await supabase.from("products").select("*").eq("id", id).maybeSingle(), "product lookup");
  return row ? fromDatabaseRow<ProductRecord>(row as Record<string, unknown>) : undefined;
}

export async function saveProductRow(product: Partial<ProductRecord> & Omit<ProductRecord, "id" | "isActive"> & { id?: string; isActive?: boolean }) {
  const row = toDatabaseRow({
    ...product,
    isActive: product.isActive ?? true,
    updatedAt: new Date().toISOString(),
  } as unknown as Record<string, unknown>);
  const request = product.id
    ? supabase.from("products").update(row).eq("id", product.id)
    : supabase.from("products").insert(row);
  const saved = unwrap(await request.select("*").single(), "product save");
  return fromDatabaseRow<ProductRecord>(saved as unknown as Record<string, unknown>);
}

export async function createCartRow(id: string, userId?: string) {
  const row = unwrap(await supabase.from("carts").insert({ id, ...(userId ? { user_id: userId } : {}) }).select("*").single(), "cart create");
  return fromDatabaseRow<{ id: string; userId: string | null; note: string; expiresAt: Date }>(row as unknown as Record<string, unknown>);
}

export async function getCartRow(id: string) {
  const row = unwrap(await supabase.from("carts").select("*").eq("id", id).gt("expires_at", new Date().toISOString()).maybeSingle(), "cart read");
  return row ? fromDatabaseRow<{ id: string; userId: string | null; note: string; expiresAt: Date }>(row as Record<string, unknown>) : undefined;
}

export async function listCartItemRows(cartId: string) {
  const rows = unwrap(await supabase.from("cart_items").select("*").eq("cart_id", cartId).order("created_at"), "cart item list") as Record<string, unknown>[];
  return rows.map(row => fromDatabaseRow<CartItemRecord>(row));
}

export async function upsertCartItemRow(cartId: string, productId: string, quantity: number) {
  const row = unwrap(await supabase.from("cart_items")
    .upsert({ cart_id: cartId, product_id: productId, quantity, updated_at: new Date().toISOString() }, { onConflict: "cart_id,product_id" })
    .select("*").single(), "cart item save");
  return fromDatabaseRow<CartItemRecord>(row as unknown as Record<string, unknown>);
}

export async function updateCartItemRow(cartId: string, itemId: string, quantity: number) {
  const row = unwrap(await supabase.from("cart_items").update({ quantity, updated_at: new Date().toISOString() })
    .eq("cart_id", cartId).eq("id", itemId).select("*").maybeSingle(), "cart item update");
  return row ? fromDatabaseRow<CartItemRecord>(row as Record<string, unknown>) : undefined;
}

export async function deleteCartItemRow(cartId: string, itemId: string) {
  unwrap(await supabase.from("cart_items").delete().eq("cart_id", cartId).eq("id", itemId), "cart item remove");
}

export async function updateCartNoteRow(cartId: string, note: string) {
  unwrap(await supabase.from("carts").update({ note, updated_at: new Date().toISOString() }).eq("id", cartId), "cart note update");
}

export async function attachCartToUser(cartId: string, userId: string) {
  unwrap(await supabase.from("carts").update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq("id", cartId).or(`user_id.is.null,user_id.eq.${userId}`), "cart account link");
}

export async function getUserProfile(userId: string) {
  const row = unwrap(await supabase.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(), "profile read");
  return row ? fromDatabaseRow<UserProfileRecord>(row as Record<string, unknown>) : undefined;
}

export async function saveUserProfile(input: Pick<UserProfileRecord, "userId" | "email" | "displayName" | "role">) {
  const row = unwrap(await supabase.from("user_profiles").upsert({
    user_id: input.userId, email: input.email, display_name: input.displayName, role: input.role,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" }).select("*").single(), "profile save");
  return fromDatabaseRow<UserProfileRecord>(row as unknown as Record<string, unknown>);
}

export async function reserveOrderProductStock(orderId: string) {
  unwrap(await supabase.rpc("reserve_order_stock", { p_order_id: orderId }), "product stock reservation");
}

export async function releaseOrderProductStock(orderId: string) {
  unwrap(await supabase.rpc("release_order_stock", { p_order_id: orderId }), "product stock release");
}

export async function uploadProductImage(name: string, bytes: Buffer, contentType: string) {
  if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(name) ||
    !["image/jpeg", "image/png", "image/webp"].includes(contentType) || bytes.length > 5 * 1024 * 1024) {
    throw new Error("Invalid product image.");
  }
  const storage = supabase.storage.from("amore-products");
  const uploaded = await storage.upload(name, bytes, { contentType, cacheControl: "31536000", upsert: true });
  if (uploaded.error) {
    const error = new Error("Supabase product image upload failed.");
    Object.assign(error, { code: uploaded.error.name });
    throw error;
  }
  return storage.getPublicUrl(name).data.publicUrl;
}

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

export type AccountOrderRecord = {
  id: string;
  userId: string;
  number: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalFils: number;
  currency: string;
  items: { title: string; quantity: number }[];
  createdAt: Date;
  updatedAt: Date;
};

export async function listAccountOrderRows(client: SupabaseClient) {
  const rows = unwrap(await client.from("orders").select("*")
    .order("created_at", { ascending: false }).limit(100), "account order list") as Record<string, unknown>[];
  return rows.map(row => fromDatabaseRow<AccountOrderRecord>(row));
}

export type FavoriteRecord = { productId: string; createdAt: Date };

export async function listFavoriteRows(client: SupabaseClient) {
  const rows = unwrap(await client.from("favorites").select("product_id,created_at")
    .order("created_at", { ascending: false }).limit(500), "favorite list") as Record<string, unknown>[];
  return rows.map(row => fromDatabaseRow<FavoriteRecord>(row));
}

export async function addFavoriteRow(client: SupabaseClient, userId: string, productId: string) {
  const row = unwrap(await client.from("favorites")
    .upsert({ user_id: userId, product_id: productId }, { onConflict: "user_id,product_id" })
    .select("product_id,created_at").single(), "favorite save") as Record<string, unknown>;
  return fromDatabaseRow<FavoriteRecord>(row);
}

export async function removeFavoriteRow(client: SupabaseClient, productId: string) {
  unwrap(await client.from("favorites").delete().eq("product_id", productId), "favorite remove");
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

