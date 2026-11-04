// Schema definitions are safe to reuse: never import the real database entrypoint.
import { inquiriesTable } from "../../../../../lib/db/src/schema/inquiries";
import { storeSettingsTable } from "../../../../../lib/db/src/schema/store-settings";
export { inquiriesTable, storeSettingsTable };
export { customerOrdersTable } from "../../../../../lib/db/src/schema/customer-orders";

const fixture = () => ({
  id: 17, cafeName: "Fictional cafe", contactName: "Test contact",
  phone: "+96550000000", email: "cafe@example.invalid", area: "Test area",
  products: "Test cookies", notes: "", requestKey: "fictional-request-key",
  requestHash: "fictional-request-hash", status: "new",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});
export const state = {
  calls: [] as string[],
  settings: null as Record<string, unknown> | null,
  inquiry: fixture(),
};
export function resetDatabase() {
  state.calls = [];
  state.settings = null;
  state.inquiry = fixture();
}
export const db = {
  select() {
    state.calls.push("select");
    return {
      from(table: unknown) {
        if (table !== storeSettingsTable) throw new Error("Unexpected table read");
        return { async where() { return state.settings ? [{ content: state.settings }] : []; } };
      },
    };
  },
  insert(table: unknown) {
    state.calls.push("insert");
    if (table !== storeSettingsTable) throw new Error("Unexpected table insert");
    return {
      values(row: { id: string; content: Record<string, unknown> }) {
        if (row.id !== "amore") throw new Error("Unexpected settings id");
        return {
          async onConflictDoUpdate() { state.settings = structuredClone(row.content); },
        };
      },
    };
  },
  update(table: unknown) {
    state.calls.push("update");
    if (table !== inquiriesTable) throw new Error("Unexpected table update");
    return {
      set(data: { status: string }) {
        return {
          where() {
            return {
              async returning() {
                state.inquiry = { ...state.inquiry, ...data };
                return [state.inquiry];
              },
            };
          },
        };
      },
    };
  },
};
export const pool = {
  async query() { throw new Error("Unexpected SQL in admin HTTP tests"); },
};
