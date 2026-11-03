import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const storeSettingsTable = pgTable("store_settings", {
  id: text("id").primaryKey().default("amore"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertStoreSettingsSchema = createInsertSchema(storeSettingsTable);
export type StoreSettingsRecord = typeof storeSettingsTable.$inferSelect;
