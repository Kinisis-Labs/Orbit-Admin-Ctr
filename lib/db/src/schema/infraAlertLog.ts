import { pgTable, serial, text, timestamp, numeric } from "drizzle-orm/pg-core";

/**
 * Persists a row for every infra-pressure notification that fires.
 * Each row captures the app, the metric (cpu or memory), the observed value
 * and configured threshold at alert time, and which notification channels were
 * used (comma-separated, e.g. "teams,email").
 */
export const infraAlertLogTable = pgTable("infra_alert_log", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  metric: text("metric").notNull(),
  value: numeric("value", { precision: 8, scale: 2 }).notNull(),
  threshold: numeric("threshold", { precision: 8, scale: 2 }).notNull(),
  channels: text("channels").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: text("acknowledged_by"),
});

export type InfraAlertLogRow = typeof infraAlertLogTable.$inferSelect;
