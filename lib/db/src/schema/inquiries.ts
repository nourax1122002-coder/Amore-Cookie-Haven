import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const inquiriesTable = pgTable("cafe_inquiries", {
  id: serial("id").primaryKey(),
  cafeName: text("cafe_name").notNull(),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  area: text("area").notNull(),
  products: text("products").notNull(),
  notes: text("notes").notNull().default(""),
  requestKey: text("request_key").unique().notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertInquirySchema = createInsertSchema(inquiriesTable).omit({ id: true, createdAt: true });
export type InquiryRecord = typeof inquiriesTable.$inferSelect;
