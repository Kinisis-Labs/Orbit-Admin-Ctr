import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * Persists per-app CPU and memory alert threshold overrides set by operators
 * via the Orbit UI. Rows here take precedence over the static APPS inventory
 * defaults and the global env-var thresholds.
 */
export const appThresholdsTable = pgTable("app_thresholds", {
  appId: text("app_id").primaryKey(),
  cpuThreshold: numeric("cpu_threshold", { precision: 5, scale: 2 }).notNull(),
  memoryThreshold: numeric("memory_threshold", { precision: 5, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull().default(""),
});

export type AppThresholdsRow = typeof appThresholdsTable.$inferSelect;
