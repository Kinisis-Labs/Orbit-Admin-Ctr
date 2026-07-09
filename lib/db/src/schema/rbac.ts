import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  unique,
} from "drizzle-orm/pg-core";

// ── Roles ─────────────────────────────────────────────────────────────────────

export const rolesTable = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

// ── Permissions ───────────────────────────────────────────────────────────────

export const permissionsTable = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  application: text("application").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

// ── Role ↔ Permission Mapping ─────────────────────────────────────────────────

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissionsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [unique("uq_role_permission").on(t.roleId, t.permissionId)],
);

// ── User ↔ Role Assignment ────────────────────────────────────────────────────
// Uses the Entra object ID (oid) as the userId to avoid a separate users table.

export const userRolesTable = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [unique("uq_user_role").on(t.userId, t.roleId)],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoleRow = typeof rolesTable.$inferSelect;
export type RoleInsert = typeof rolesTable.$inferInsert;
export type PermissionRow = typeof permissionsTable.$inferSelect;
export type PermissionInsert = typeof permissionsTable.$inferInsert;
export type RolePermissionRow = typeof rolePermissionsTable.$inferSelect;
export type RolePermissionInsert = typeof rolePermissionsTable.$inferInsert;
export type UserRoleRow = typeof userRolesTable.$inferSelect;
export type UserRoleInsert = typeof userRolesTable.$inferInsert;
