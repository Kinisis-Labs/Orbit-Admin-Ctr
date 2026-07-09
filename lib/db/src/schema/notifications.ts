import { pgTable, text, boolean, timestamp, uuid, index } from "drizzle-orm/pg-core";

export type NotificationType = "info" | "warning" | "error" | "success" | "announcement";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Audience — null = broadcast to all users
    userId: text("user_id"),
    // Content
    title: text("title").notNull(),
    body: text("body").notNull(),
    type: text("type").notNull().$type<NotificationType>().default("info"),
    // Link to navigate to on click (optional)
    actionUrl: text("action_url"),
    // State
    read: boolean("read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Metadata
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_notifications_user_id").on(t.userId),
    index("idx_notifications_read").on(t.read),
    index("idx_notifications_created_at").on(t.createdAt),
  ],
);

export type NotificationRow = typeof notificationsTable.$inferSelect;
export type NotificationInsert = typeof notificationsTable.$inferInsert;
