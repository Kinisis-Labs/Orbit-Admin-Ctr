import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";

// Raw Clerk webhook events, keyed by the Svix message id so replays are
// idempotent. Deliberately stores NO payload and NO PII — only the opaque
// Clerk user id, the event type, and timestamps. Consumer-app end users are
// counted anonymously; Orbit never persists emails or names.
export const clerkEventsTable = pgTable("clerk_events", {
  svixId: text("svix_id").primaryKey(),
  appId: text("app_id").notNull(),
  eventType: text("event_type").notNull(),
  clerkUserId: text("clerk_user_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per (app, end user), identified only by the app's opaque Clerk user
// id. Powers total members + DAU/WAU/MAU + new-7d. No email/name is ever
// stored, so there is no consumer-PII leakage surface.
export const appUsersTable = pgTable(
  "app_users",
  {
    appId: text("app_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.appId, t.clerkUserId] })],
);

// Per-app daily snapshot of the aggregate counts, upserted opportunistically on
// each ingested event. Gives the DAU trend a prior day to compare against
// without needing a scheduler.
export const clerkActivityDailyTable = pgTable(
  "clerk_activity_daily",
  {
    appId: text("app_id").notNull(),
    day: date("day").notNull(),
    dau: integer("dau").notNull().default(0),
    wau: integer("wau").notNull().default(0),
    mau: integer("mau").notNull().default(0),
    totalMembers: integer("total_members").notNull().default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.day] })],
);

export type ClerkEventRow = typeof clerkEventsTable.$inferSelect;
export type AppUserRow = typeof appUsersTable.$inferSelect;
export type ClerkActivityDailyRow = typeof clerkActivityDailyTable.$inferSelect;
