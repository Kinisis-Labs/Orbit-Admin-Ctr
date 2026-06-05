import { pgTable, text, timestamp, numeric } from "drizzle-orm/pg-core";

/**
 * Persists the most recent successful Azure Budget fetch per app.
 * Provides an offline fallback so restarts serve stale-but-real values
 * instead of formula estimates when Azure Budgets is temporarily unavailable.
 */
export const budgetSnapshotsTable = pgTable("budget_snapshots", {
  appId: text("app_id").primaryKey(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  forecastAmount: numeric("forecast_amount", { precision: 14, scale: 2 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BudgetSnapshotRow = typeof budgetSnapshotsTable.$inferSelect;
