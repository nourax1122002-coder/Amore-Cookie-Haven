import { pgTable, text, integer, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export type AccountOrderItem = { title: string; quantity: number };

export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  number: text("number").notNull(),
  paymentStatus: text("payment_status").notNull(),
  paymentProvider: text("payment_provider"),
  fulfillmentStatus: text("fulfillment_status").notNull(),
  totalFils: integer("total_fils").notNull(),
  currency: text("currency").notNull(),
  items: jsonb("items").$type<AccountOrderItem[]>().notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  stripeRefundedAmountFils: integer("stripe_refunded_amount_fils").notNull().default(0),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ createdAt: true, updatedAt: true });
export type InsertOrder = typeof ordersTable.$inferInsert;
export type AccountOrder = typeof ordersTable.$inferSelect;
