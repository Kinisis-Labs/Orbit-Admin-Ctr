import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const featureFlagsTable = pgTable("feature_flags", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlagRow = typeof featureFlagsTable.$inferSelect;
