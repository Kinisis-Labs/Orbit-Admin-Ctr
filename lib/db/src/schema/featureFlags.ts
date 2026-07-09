import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const featureFlagsTable = pgTable("feature_flags", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  description: text("description"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlagRow = typeof featureFlagsTable.$inferSelect;
export type FeatureFlagInsert = typeof featureFlagsTable.$inferInsert;
