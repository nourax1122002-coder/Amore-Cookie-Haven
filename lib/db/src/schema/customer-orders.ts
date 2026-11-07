import { pgTable, text, integer, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export type OrderItem = { variantId: string; title: string; quantity: number; unitFils: number };
export type StockPlan = { productId: string; quantity: number };
// Historical orders have no point; every new direct checkout requires one.
export type OrderAddress = {
  area: string; block: string; street: string; house: string;
  location?: { latitude: number; longitude: number };
};
export type StockQuantity = StockPlan;
export const customerOrdersTable = pgTable("customer_orders", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  cartHash: text("cart_hash").notNull(),
  requestKey: text("request_key").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  tokenHash: text("token_hash").notNull(),
  phone: text("phone").notNull(),
  address: jsonb("address").$type<OrderAddress>().notNull(),
  note: text("note").notNull().default(""),
  items: jsonb("items").$type<OrderItem[]>().notNull(),
  subtotalFils: integer("subtotal_fils").notNull(),
  shippingFils: integer("shipping_fils").notNull(),
  totalFils: integer("total_fils").notNull(),
  currency: text("currency").notNull().default("KWD"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("received"),
  invoiceId: text("invoice_id").unique(),
  paymentId: text("payment_id").unique(),
  paymentUrl: text("payment_url"),
  stockStatus: text("stock_status").notNull().default("unreserved"),
  stockPlan: jsonb("stock_plan").$type<StockQuantity[]>(),
  releasePlan: jsonb("release_plan").$type<StockQuantity[]>(),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const insertCustomerOrderSchema = createInsertSchema(customerOrdersTable).omit({ createdAt: true, updatedAt: true });
export type CustomerOrder = typeof customerOrdersTable.$inferSelect;
