import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * Immutable audit trail for every write to app_thresholds.
 * Each PUT to /apps/:appId/thresholds appends one row here (alongside the
 * upsert to app_thresholds), capturing the old and new values so operators
 * can review the full history of threshold changes.
 */
export const appThresholdsLogTable = pgTable("app_thresholds_log", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  oldCpuThreshold: numeric("old_cpu_threshold", { precision: 5, scale: 2 }),
  newCpuThreshold: numeric("new_cpu_threshold", { precision: 5, scale: 2 }).notNull(),
  oldMemoryThreshold: numeric("old_memory_threshold", { precision: 5, scale: 2 }),
  newMemoryThreshold: numeric("new_memory_threshold", { precision: 5, scale: 2 }).notNull(),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppThresholdsLogRow = typeof appThresholdsLogTable.$inferSelect;
