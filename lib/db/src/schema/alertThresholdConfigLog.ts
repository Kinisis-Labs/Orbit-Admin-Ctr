import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Immutable audit trail for every write to alert_threshold_config.
 * Each PUT to /alerts/config/:appId appends one row here (alongside the
 * upsert to alert_threshold_config), capturing old and new values so
 * operators can review the full history of threshold changes.
 *
 * Null on an old* column means no previous DB override existed (first-ever set).
 * Null on a new* column means the operator cleared the DB override for that field.
 */
export const alertThresholdConfigLogTable = pgTable("alert_threshold_config_log", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  oldCpuThresholdPct: integer("old_cpu_threshold_pct"),
  newCpuThresholdPct: integer("new_cpu_threshold_pct"),
  oldMemoryThresholdPct: integer("old_memory_threshold_pct"),
  newMemoryThresholdPct: integer("new_memory_threshold_pct"),
  oldConsecutiveChecks: integer("old_consecutive_checks"),
  newConsecutiveChecks: integer("new_consecutive_checks"),
  oldCooldownHours: integer("old_cooldown_hours"),
  newCooldownHours: integer("new_cooldown_hours"),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlertThresholdConfigLogRow = typeof alertThresholdConfigLogTable.$inferSelect;
