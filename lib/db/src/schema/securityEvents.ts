import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const securityEventsTable = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    userId: text("user_id"),
    userDisplayName: text("user_display_name"),
    ipAddress: text("ip_address"),
    detail: text("detail").notNull(),
    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sec_events_source_idx").on(t.source),
    index("sec_events_severity_idx").on(t.severity),
    index("sec_events_created_idx").on(t.createdAt),
  ],
);

export type SecurityEventRow = typeof securityEventsTable.$inferSelect;
export type SecurityEventInsert = typeof securityEventsTable.$inferInsert;
