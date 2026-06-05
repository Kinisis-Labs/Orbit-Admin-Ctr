import { pgTable, text, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";

/**
 * Persists the most recent successful Azure Cost Management fetch per app.
 * Provides an offline fallback so restarts serve stale-but-real cost figures
 * instead of formula estimates when Azure Cost Management is temporarily unavailable.
 *
 * byService is stored as a JSON array of { service, amount, trend? } objects
 * (matches the CostByService type in azureCost.ts).
 */
export const costSnapshotsTable = pgTable("cost_snapshots", {
  appId: text("app_id").primaryKey(),
  monthToDate: numeric("month_to_date", { precision: 14, scale: 2 }).notNull(),
  byService: jsonb("by_service").notNull(),
  dataAsOf: timestamp("data_as_of", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CostSnapshotRow = typeof costSnapshotsTable.$inferSelect;
