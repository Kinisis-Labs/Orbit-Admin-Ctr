import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";

export const applicationsTable = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  url: text("url"),
  healthCheckUrl: text("health_check_url"),
  appInsightsConnectionString: text("app_insights_connection_string"),
  category: text("category").notNull().default("application"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

export const entraGroupMappingsTable = pgTable("entra_group_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applicationsTable.id, { onDelete: "cascade" }),
  entraGroupId: text("entra_group_id").notNull(),
  entraGroupName: text("entra_group_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

export type ApplicationRow = typeof applicationsTable.$inferSelect;
export type ApplicationInsert = typeof applicationsTable.$inferInsert;
export type EntraGroupMappingRow = typeof entraGroupMappingsTable.$inferSelect;
export type EntraGroupMappingInsert = typeof entraGroupMappingsTable.$inferInsert;
