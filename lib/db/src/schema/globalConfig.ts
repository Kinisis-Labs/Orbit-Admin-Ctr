import { pgTable, text, boolean, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

// ── Global Configuration ───────────────────────────────────────────────────────
// Key-value store for platform-wide settings.

export const globalConfigTable = pgTable(
  "global_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    isSecret: boolean("is_secret").notNull().default(false),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idx_global_config_key").on(t.key)],
);

export type GlobalConfigRow = typeof globalConfigTable.$inferSelect;
export type GlobalConfigInsert = typeof globalConfigTable.$inferInsert;
