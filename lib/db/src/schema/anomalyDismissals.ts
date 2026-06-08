import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Persists anomaly-banner dismissals keyed by (session_id, app_id, date_key).
 *
 * scope = "session"  — only visible to the session that created it (default)
 * scope = "global"   — visible to all sessions; session_id is set to the
 *                      sentinel "__global__" so the unique PK still enforces
 *                      one global row per (app_id, date_key).
 *
 * dismissed_by stores the operator's display name or UPN when scope = "global"
 * so the banner can show "Dismissed by Alice".
 */
export const anomalyDismissalsTable = pgTable(
  "anomaly_dismissals",
  {
    sessionId: text("session_id").notNull(),
    appId: text("app_id").notNull(),
    /** ISO date string (YYYY-MM-DD) identifying the anomalous day */
    dateKey: text("date_key").notNull(),
    /** "session" (default) or "global" */
    scope: text("scope").notNull().default("session"),
    /** Operator display name / UPN — populated for global dismissals */
    dismissedBy: text("dismissed_by"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.appId, t.dateKey] })],
);

export type AnomalyDismissalRow = typeof anomalyDismissalsTable.$inferSelect;
