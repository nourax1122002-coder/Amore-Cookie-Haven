import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccountOrderRows } from "./repositories";

const firstUser = "00000000-0000-4000-8000-000000000001";
const secondUser = "00000000-0000-4000-8000-000000000002";
const orderRows = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    user_id: firstUser,
    number: "AM-OWNED-1",
    payment_status: "paid",
    fulfillment_status: "preparing",
    total_fils: 12500,
    currency: "KWD",
    items: [{ title: "Chocolate cookie", quantity: 2 }],
    created_at: "2026-11-01T12:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000022",
    user_id: secondUser,
    number: "AM-OWNED-2",
    payment_status: "pending",
    fulfillment_status: "received",
    total_fils: 9000,
    currency: "KWD",
    items: [{ title: "Vanilla cookie", quantity: 1 }],
    created_at: "2026-11-02T12:00:00.000Z",
  },
];

function scopedClient() {
  const queries: { table: string; selected: string; userId?: string; limit?: number }[] = [];
  const client = {
    from(table: string) {
      const query: any = { table, selected: "", userId: undefined, limit: undefined };
      queries.push(query);
      const builder = {
        select(columns: string) { query.selected = columns; return builder; },
        eq(column: string, value: string) {
          assert.equal(column, "user_id");
          query.userId = value;
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          assert.equal(column, "created_at");
          assert.deepEqual(options, { ascending: false });
          return builder;
        },
        limit(value: number) { query.limit = value; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          const selectedColumns = query.selected.split(",");
          const visible = orderRows
            .filter(row => row.user_id === query.userId)
            .map(row => Object.fromEntries(selectedColumns.map((column: string) => [
              column, (row as unknown as Record<string, unknown>)[column],
            ])));
          return Promise.resolve({ data: visible, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

test("account order reads are explicitly scoped to the authenticated user", async () => {
  const { client, queries } = scopedClient();

  const firstOrders = await listAccountOrderRows(client, firstUser);
  const secondOrders = await listAccountOrderRows(client, secondUser);

  assert.deepEqual(firstOrders.map(order => order.number), ["AM-OWNED-1"]);
  assert.deepEqual(secondOrders.map(order => order.number), ["AM-OWNED-2"]);
  assert.deepEqual(queries.map(query => query.userId), [firstUser, secondUser]);
  assert.ok(queries.every(query => query.table === "orders" && query.limit === 100));
  assert.ok(queries.every(query => query.selected ===
    "id,number,payment_status,fulfillment_status,total_fils,currency,items,created_at"));
  assert.equal("userId" in firstOrders[0], false);
});
