import { pgTable, uuid, text, real, timestamp, index } from "drizzle-orm/pg-core";

export const nocMetricSnapshotsTable = pgTable(
  "noc_metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: text("resource_id").notNull(),
    resourceName: text("resource_name").notNull(),
    resourceType: text("resource_type").notNull(),
    metricName: text("metric_name").notNull(),
    value: real("value"),
    unit: text("unit"),
    source: text("source").notNull().default("azure-monitor"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("noc_snapshots_resource_idx").on(t.resourceId),
    index("noc_snapshots_captured_idx").on(t.capturedAt),
  ],
);

export type NocMetricSnapshotRow = typeof nocMetricSnapshotsTable.$inferSelect;
export type NocMetricSnapshotInsert = typeof nocMetricSnapshotsTable.$inferInsert;
