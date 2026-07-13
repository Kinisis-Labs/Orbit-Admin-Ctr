import { Router } from "express";
import { eq, inArray, gt, sql } from "drizzle-orm";
import { db } from "../../lib/db.js";
import {
  userSessionsTable,
  rolesTable,
  permissionsTable,
  rolePermissionsTable,
  userRolesTable,
  applicationsTable,
  entraGroupMappingsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";
import type { SessionUser } from "../../lib/session.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SessionPayload {
  user?: SessionUser;
}

/** Extract unique active users from the session store. */
async function getActiveUsers(): Promise<SessionUser[]> {
  const now = new Date();
  const rows = await db
    .select({ sess: userSessionsTable.sess })
    .from(userSessionsTable)
    .where(gt(userSessionsTable.expire, now));

  const seen = new Set<string>();
  const users: SessionUser[] = [];

  for (const row of rows) {
    const payload = row.sess as SessionPayload;
    if (!payload?.user?.id) continue;
    if (seen.has(payload.user.id)) continue;
    seen.add(payload.user.id);
    users.push(payload.user);
  }

  return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── GET /api/users — list all known users (from active sessions) ──────────────
router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await getActiveUsers();
    const summary = users.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      userPrincipalName: u.userPrincipalName,
      jobTitle: u.jobTitle,
      isAdmin: u.isAdmin,
      isEngineer: u.isEngineer,
      groupCount: u.groupIds?.length ?? 0,
    }));
    res.json(summary);
  } catch (err) {
    req.log.error(err, "GET /api/users failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /api/users/:userId — full security context for one user ───────────────
router.get("/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const now = new Date();

    // Find the most-recently created session for this user
    const rows = await db
      .select({ sess: userSessionsTable.sess })
      .from(userSessionsTable)
      .where(gt(userSessionsTable.expire, now))
      .orderBy(sql`${userSessionsTable.expire} desc`);

    let targetUser: SessionUser | undefined;
    for (const row of rows) {
      const payload = row.sess as SessionPayload;
      if (payload?.user?.id === userId) {
        targetUser = payload.user;
        break;
      }
    }

    if (!targetUser) {
      res.status(404).json({ message: "User not found or has no active session" });
      return;
    }

    // Assigned roles
    const assignedRoles = await db
      .select({ id: rolesTable.id, name: rolesTable.name, displayName: rolesTable.displayName, assignmentId: userRolesTable.id })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(eq(userRolesTable.userId, userId));

    // Effective permissions (via roles)
    let effectivePermissions: string[] = [];
    if (targetUser.isAdmin) {
      const allPerms = await db
        .select({ name: permissionsTable.name })
        .from(permissionsTable)
        .where(eq(permissionsTable.enabled, true));
      effectivePermissions = allPerms.map((p) => p.name);
    } else if (assignedRoles.length > 0) {
      const roleIds = assignedRoles.map((r) => r.id);
      const rp = await db
        .select({ permissionId: rolePermissionsTable.permissionId })
        .from(rolePermissionsTable)
        .where(inArray(rolePermissionsTable.roleId, roleIds));
      if (rp.length > 0) {
        const permIds = rp.map((r) => r.permissionId);
        const perms = await db
          .select({ name: permissionsTable.name })
          .from(permissionsTable)
          .where(inArray(permissionsTable.id, permIds));
        effectivePermissions = perms.map((p) => p.name);
      }
    }

    // Authorized applications (group-gated, same logic as /api/applications)
    const userGroupIds = new Set(targetUser.groupIds ?? []);
    const allApps = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.enabled, true));

    const mappings = await db.select().from(entraGroupMappingsTable);
    const appMappings = new Map<string, string[]>();
    for (const m of mappings) {
      if (!appMappings.has(m.applicationId)) appMappings.set(m.applicationId, []);
      appMappings.get(m.applicationId)!.push(m.entraGroupId);
    }

    const authorizedApps = targetUser.isAdmin
      ? allApps
      : allApps.filter((app) => {
          const groups = appMappings.get(app.id);
          if (!groups || groups.length === 0) return true;
          return groups.some((g) => userGroupIds.has(g));
        });

    res.json({
      id: targetUser.id,
      displayName: targetUser.displayName,
      userPrincipalName: targetUser.userPrincipalName,
      jobTitle: targetUser.jobTitle,
      isAdmin: targetUser.isAdmin,
      isEngineer: targetUser.isEngineer,
      groupIds: targetUser.groupIds ?? [],
      assignedRoles,
      effectivePermissions,
      authorizedApplications: authorizedApps.map((a) => ({
        id: a.id,
        slug: a.slug,
        displayName: a.displayName,
        url: a.url,
        category: a.category,
      })),
    });
  } catch (err) {
    req.log.error(err, "GET /api/users/:userId failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /api/users/:userId/roles — assigned roles ─────────────────────────────
router.get("/users/:userId/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const rows = await db
      .select({
        id: rolesTable.id,
        name: rolesTable.name,
        displayName: rolesTable.displayName,
        assignmentId: userRolesTable.id,
      })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(eq(userRolesTable.userId, userId));
    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/users/:userId/roles failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
