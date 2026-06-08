import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Persists anomaly-banner dismissals keyed by (session_id, app_id, date_key).
 * Using the session id (not a user id) means:
 *   - works in both mock and Entra modes
 *   - dismissal survives browser storage clears (as long as the cookie is alive)
 *   - two different sessions / two staff members each see the banner independently
 */
export const anomalyDismissalsTable = pgTable(
  "anomaly_dismissals",
  {
    sessionId: text("session_id").notNull(),
    appId: text("app_id").notNull(),
    /** ISO date string (YYYY-MM-DD) identifying the anomalous day */
    dateKey: text("date_key").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.appId, t.dateKey] })],
);

export type AnomalyDismissalRow = typeof anomalyDismissalsTable.$inferSelect;
