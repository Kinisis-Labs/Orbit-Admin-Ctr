import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-app infra alert threshold overrides set by operators from the Orbit UI.
 * A null column means "no DB override — fall back to env var or global default".
 *
 * Priority order for each threshold:
 *   1. Row in this table (if present and non-null)
 *   2. Per-app env var (e.g. ALERT_CPU_THRESHOLD_PCT__GRAILBABE)
 *   3. Global env var (e.g. ALERT_CPU_THRESHOLD_PCT)
 *   4. Built-in default (cpu=80, memory=85, consecutiveChecks=2)
 */
export const alertThresholdConfigTable = pgTable("alert_threshold_config", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull().unique(),
  cpuThresholdPct: integer("cpu_threshold_pct"),
  memoryThresholdPct: integer("memory_threshold_pct"),
  consecutiveChecks: integer("consecutive_checks"),
  cooldownHours: integer("cooldown_hours"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type AlertThresholdConfigRow = typeof alertThresholdConfigTable.$inferSelect;
