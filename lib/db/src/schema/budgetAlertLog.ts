import { pgTable, serial, text, timestamp, numeric } from "drizzle-orm/pg-core";

/**
 * Persists a row for every budget-overrun notification that fires.
 * Each row captures the app, the financial snapshot at the time of the alert,
 * and which notification channels were used (comma-separated, e.g. "teams,email").
 */
export const budgetAlertLogTable = pgTable("budget_alert_log", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  mtd: numeric("mtd", { precision: 14, scale: 2 }).notNull(),
  forecast: numeric("forecast", { precision: 14, scale: 2 }).notNull(),
  budget: numeric("budget", { precision: 14, scale: 2 }).notNull(),
  channels: text("channels").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedNote: text("acknowledged_note"),
});

export type BudgetAlertLogRow = typeof budgetAlertLogTable.$inferSelect;
