import { pgTable, text, timestamp, numeric } from "drizzle-orm/pg-core";

/**
 * Manually-entered monthly budget amounts per app.
 * These take highest priority over Azure Budget API lookups and env-var overrides.
 * appId is the canonical app ID from the APPS inventory, or a virtual ID such as
 * "microsoft365" for spend categories not backed by an Azure app record.
 */
export const manualBudgetsTable = pgTable("manual_budgets", {
  appId: text("app_id").primaryKey(),
  monthlyBudget: numeric("monthly_budget", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type ManualBudgetRow = typeof manualBudgetsTable.$inferSelect;
export type NewManualBudgetRow = typeof manualBudgetsTable.$inferInsert;
