import { pgTable, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Temporary abuse-prevention state only. Never store order/customer records here.
export const securityCountersTable = pgTable("security_counters", {
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  hits: integer("hits").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [
  primaryKey({ columns: [table.scope, table.keyHash] }),
  index("security_counters_expiry_idx").on(table.expiresAt),
]);

export const insertSecurityCounterSchema = createInsertSchema(securityCountersTable);
export type SecurityCounter = typeof securityCountersTable.$inferSelect;
