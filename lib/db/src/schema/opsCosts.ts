import { pgTable, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";

/**
 * Manually-configured recurring operational cost line items for Business Ops
 * (kinisis-labs). Tracks non-Azure spend such as M365 licenses, domain
 * registrations, CDN / network-ops subscriptions, etc.
 *
 * category must be one of: "website-ops" | "network-ops" | "m365-licenses"
 */
export const opsCostsTable = pgTable("ops_costs", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  vendor: text("vendor"),
  amountMonthly: numeric("amount_monthly", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OpsCostRow = typeof opsCostsTable.$inferSelect;
export type NewOpsCostRow = typeof opsCostsTable.$inferInsert;
