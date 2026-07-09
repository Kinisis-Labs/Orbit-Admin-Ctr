import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";

// Audit event categories
export type AuditCategory =
  | "auth"
  | "rbac"
  | "application"
  | "configuration"
  | "admin";

// Audit event outcomes
export type AuditOutcome = "success" | "failure" | "denied";

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Who
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorUpn: text("actor_upn"),
    // What
    action: text("action").notNull(),
    category: text("category").notNull().$type<AuditCategory>(),
    outcome: text("outcome").notNull().$type<AuditOutcome>().default("success"),
    // On what entity
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    // Context
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // When
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_log_actor").on(t.actorId),
    index("idx_audit_log_action").on(t.action),
    index("idx_audit_log_category").on(t.category),
    index("idx_audit_log_created_at").on(t.createdAt),
  ],
);

export type AuditLogRow = typeof auditLogTable.$inferSelect;
export type AuditLogInsert = typeof auditLogTable.$inferInsert;
