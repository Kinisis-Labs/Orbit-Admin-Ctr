import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../lib/db.js";
import {
  rolesTable,
  permissionsTable,
  rolePermissionsTable,
  userRolesTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";
import { auditFromReq } from "../../lib/audit.js";

const router = Router();

// ── Permission Evaluation ─────────────────────────────────────────────────────
// GET /api/rbac/my-permissions
// Returns the flat list of permission names for the current user based on
// their assigned roles. Used by the frontend to gate UI controls.
router.get("/rbac/my-permissions", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user!.id;

    if (req.session.user!.isAdmin) {
      const allPerms = await db
        .select({ name: permissionsTable.name })
        .from(permissionsTable)
        .where(eq(permissionsTable.enabled, true));
      res.json({ permissions: allPerms.map((p) => p.name) });
      return;
    }

    const userRoles = await db
      .select({ roleId: userRolesTable.roleId })
      .from(userRolesTable)
      .where(eq(userRolesTable.userId, userId));

    if (userRoles.length === 0) {
      res.json({ permissions: [] });
      return;
    }

    const roleIds = userRoles.map((r) => r.roleId);
    const rolePerms = await db
      .select({ permissionId: rolePermissionsTable.permissionId })
      .from(rolePermissionsTable)
      .where(inArray(rolePermissionsTable.roleId, roleIds));

    if (rolePerms.length === 0) {
      res.json({ permissions: [] });
      return;
    }

    const permIds = rolePerms.map((rp) => rp.permissionId);
    const perms = await db
      .select({ name: permissionsTable.name })
      .from(permissionsTable)
      .where(inArray(permissionsTable.id, permIds));

    res.json({ permissions: perms.map((p) => p.name) });
  } catch (err) {
    req.log.error(err, "GET /api/rbac/my-permissions failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── Roles ─────────────────────────────────────────────────────────────────────

// GET /api/rbac/roles
router.get("/rbac/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const roles = await db.select().from(rolesTable).orderBy(rolesTable.displayName);
    res.json(roles);
  } catch (err) {
    req.log.error(err, "GET /api/rbac/roles failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/rbac/roles/:id/permissions
router.get("/rbac/roles/:id/permissions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .select({
        id: permissionsTable.id,
        name: permissionsTable.name,
        displayName: permissionsTable.displayName,
        application: permissionsTable.application,
        module: permissionsTable.module,
        action: permissionsTable.action,
        mappingId: rolePermissionsTable.id,
      })
      .from(rolePermissionsTable)
      .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
      .where(eq(rolePermissionsTable.roleId, String(id)));
    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/rbac/roles/:id/permissions failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/rbac/roles
router.post("/rbac/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      name: string;
      displayName: string;
      description?: string;
      enabled?: boolean;
    };
    if (!body.name || !body.displayName) {
      res.status(400).json({ message: "name and displayName are required" });
      return;
    }
    const [created] = await db
      .insert(rolesTable)
      .values({
        name: body.name.toLowerCase().replace(/\s+/g, "-"),
        displayName: body.displayName,
        description: body.description ?? null,
        enabled: body.enabled ?? true,
        createdBy: req.session.user!.id,
      })
      .returning();
    void auditFromReq(req, { action: "rbac.role.create", category: "rbac", entityType: "role", entityId: created.id, entityName: created.name });
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique")) {
      res.status(409).json({ message: "A role with that name already exists" });
      return;
    }
    req.log.error(err, "POST /api/rbac/roles failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /api/rbac/roles/:id
router.put("/rbac/roles/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as Partial<{
      displayName: string;
      description: string;
      enabled: boolean;
    }>;
    const [updated] = await db
      .update(rolesTable)
      .set({
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        updatedAt: new Date(),
      })
      .where(eq(rolesTable.id, String(id)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Role not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err, "PUT /api/rbac/roles/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/rbac/roles/:id
router.delete("/rbac/roles/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [role] = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.id, String(id)));
    if (!role) {
      res.status(404).json({ message: "Role not found" });
      return;
    }
    if (role.isSystem) {
      res.status(409).json({ message: "System roles cannot be deleted" });
      return;
    }
    await db.delete(rolesTable).where(eq(rolesTable.id, String(id)));
    void auditFromReq(req, { action: "rbac.role.delete", category: "rbac", entityType: "role", entityId: role.id, entityName: role.name });
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/rbac/roles/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/rbac/roles/:id/permissions — assign a permission to a role
router.post("/rbac/roles/:id/permissions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const roleId = String(req.params.id);
    const { permissionId } = req.body as { permissionId: string };
    if (!permissionId) {
      res.status(400).json({ message: "permissionId is required" });
      return;
    }
    const [created] = await db
      .insert(rolePermissionsTable)
      .values({ roleId, permissionId, createdBy: req.session.user!.id })
      .onConflictDoNothing()
      .returning();
    void auditFromReq(req, { action: "rbac.role.permission.assign", category: "rbac", entityType: "role", entityId: roleId, detail: { permissionId } });
    res.status(201).json(created ?? { roleId, permissionId });
  } catch (err) {
    req.log.error(err, "POST /api/rbac/roles/:id/permissions failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/rbac/roles/:id/permissions/:mappingId
router.delete(
  "/rbac/roles/:id/permissions/:mappingId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      await db
        .delete(rolePermissionsTable)
        .where(eq(rolePermissionsTable.id, String(req.params.mappingId)));
      res.status(204).end();
    } catch (err) {
      req.log.error(err, "DELETE /api/rbac/roles/:id/permissions/:mappingId failed");
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// ── Permissions ───────────────────────────────────────────────────────────────

// GET /api/rbac/permissions
router.get("/rbac/permissions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const perms = await db
      .select()
      .from(permissionsTable)
      .orderBy(permissionsTable.application, permissionsTable.module, permissionsTable.action);
    res.json(perms);
  } catch (err) {
    req.log.error(err, "GET /api/rbac/permissions failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/rbac/permissions
router.post("/rbac/permissions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      application: string;
      module: string;
      action: string;
      displayName?: string;
      description?: string;
    };
    if (!body.application || !body.module || !body.action) {
      res.status(400).json({ message: "application, module, and action are required" });
      return;
    }
    const name = `${body.application}.${body.module}.${body.action}`;
    const displayName = body.displayName ?? name;
    const [created] = await db
      .insert(permissionsTable)
      .values({
        name,
        displayName,
        description: body.description ?? null,
        application: body.application,
        module: body.module,
        action: body.action,
        createdBy: req.session.user!.id,
      })
      .returning();
    void auditFromReq(req, { action: "rbac.permission.create", category: "rbac", entityType: "permission", entityId: created.id, entityName: created.name });
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique")) {
      res.status(409).json({ message: "That permission already exists" });
      return;
    }
    req.log.error(err, "POST /api/rbac/permissions failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /api/rbac/permissions/:id
router.put("/rbac/permissions/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as Partial<{
      displayName: string;
      description: string;
      enabled: boolean;
    }>;
    const [updated] = await db
      .update(permissionsTable)
      .set({
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        updatedAt: new Date(),
      })
      .where(eq(permissionsTable.id, String(id)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Permission not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err, "PUT /api/rbac/permissions/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/rbac/permissions/:id
router.delete("/rbac/permissions/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [deleted] = await db
      .delete(permissionsTable)
      .where(eq(permissionsTable.id, String(req.params.id)))
      .returning();
    if (!deleted) {
      res.status(404).json({ message: "Permission not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/rbac/permissions/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── User ↔ Role Assignment ────────────────────────────────────────────────────

// GET /api/rbac/users/:userId/roles
router.get("/rbac/users/:userId/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: rolesTable.id,
        name: rolesTable.name,
        displayName: rolesTable.displayName,
        assignmentId: userRolesTable.id,
      })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(eq(userRolesTable.userId, String(req.params.userId)));
    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/rbac/users/:userId/roles failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/rbac/users/:userId/roles
router.post("/rbac/users/:userId/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const { roleId } = req.body as { roleId: string };
    if (!roleId) {
      res.status(400).json({ message: "roleId is required" });
      return;
    }
    const [created] = await db
      .insert(userRolesTable)
      .values({ userId, roleId, createdBy: req.session.user!.id })
      .onConflictDoNothing()
      .returning();
    void auditFromReq(req, { action: "rbac.user.role.assign", category: "rbac", entityType: "user", entityId: userId, detail: { roleId } });
    res.status(201).json(created ?? { userId, roleId });
  } catch (err) {
    req.log.error(err, "POST /api/rbac/users/:userId/roles failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/rbac/users/:userId/roles/:assignmentId
router.delete(
  "/rbac/users/:userId/roles/:assignmentId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = String(req.params.userId);
      const assignmentId = String(req.params.assignmentId);
      await db
        .delete(userRolesTable)
        .where(eq(userRolesTable.id, assignmentId));
      void auditFromReq(req, { action: "rbac.user.role.remove", category: "rbac", entityType: "user", entityId: userId, detail: { assignmentId } });
      res.status(204).end();
    } catch (err) {
      req.log.error(err, "DELETE /api/rbac/users/:userId/roles/:assignmentId failed");
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default router;
