import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const nocIncidentsTable = pgTable(
  "noc_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    severity: text("severity").notNull().default("unknown"),
    status: text("status").notNull().default("active"),
    service: text("service"),
    owner: text("owner"),
    source: text("source").notNull().default("azure-monitor"),
    description: text("description"),
    slaMinutes: integer("sla_minutes"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("noc_incidents_status_idx").on(t.status),
    index("noc_incidents_severity_idx").on(t.severity),
    index("noc_incidents_created_idx").on(t.createdAt),
    index("noc_incidents_external_idx").on(t.externalId),
  ],
);

export type NocIncidentRow = typeof nocIncidentsTable.$inferSelect;
export type NocIncidentInsert = typeof nocIncidentsTable.$inferInsert;
