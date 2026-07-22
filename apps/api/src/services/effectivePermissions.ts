import { eq, inArray } from "drizzle-orm";
import { permissionsTable, rolePermissionsTable, userRolesTable } from "@workspace/db";
import { db } from "../lib/db.js";

export async function resolveEffectivePermissions(
  userId: string,
  isAdmin: boolean,
): Promise<string[]> {
  if (isAdmin) {
    const rows = await db
      .select({ name: permissionsTable.name })
      .from(permissionsTable)
      .where(eq(permissionsTable.enabled, true));
    return rows.map((row) => row.name).sort();
  }

  const roles = await db
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  if (roles.length === 0) return [];

  const mappings = await db
    .select({ permissionId: rolePermissionsTable.permissionId })
    .from(rolePermissionsTable)
    .where(
      inArray(
        rolePermissionsTable.roleId,
        roles.map((role) => role.roleId),
      ),
    );
  if (mappings.length === 0) return [];

  const rows = await db
    .select({ name: permissionsTable.name })
    .from(permissionsTable)
    .where(
      inArray(
        permissionsTable.id,
        mappings.map((mapping) => mapping.permissionId),
      ),
    );
  return [...new Set(rows.map((row) => row.name))].sort();
}
