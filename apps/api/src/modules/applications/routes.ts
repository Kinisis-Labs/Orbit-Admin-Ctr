import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import {
  applicationsTable,
  entraGroupMappingsTable,
  type ApplicationInsert,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";

const router = Router();

// ── GET /api/applications ─────────────────────────────────────────────────────
// Returns apps the authenticated user is authorized to see, based on their
// Entra group memberships. Admins see all apps regardless of group mapping.
router.get("/applications", requireAuth, async (req, res) => {
  try {
    const user = req.session.user!;
    const userGroupIds = new Set(user.groupIds);

    const [apps, mappings] = await Promise.all([
      db.select().from(applicationsTable).where(eq(applicationsTable.enabled, true)),
      db.select().from(entraGroupMappingsTable),
    ]);

    // Admins see every enabled app
    if (user.isAdmin) {
      res.json(apps);
      return;
    }

    // Build a set of app IDs the user's groups unlock
    const authorizedAppIds = new Set(
      mappings
        .filter((m) => userGroupIds.has(m.entraGroupId))
        .map((m) => m.applicationId),
    );

    const authorized = apps.filter((app) => authorizedAppIds.has(app.id));
    res.json(authorized);
  } catch (err) {
    req.log.error(err, "GET /api/applications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /api/applications/all ─────────────────────────────────────────────────
// Admin: returns ALL apps (enabled + disabled) with their group mappings.
router.get("/applications/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [apps, mappings] = await Promise.all([
      db.select().from(applicationsTable),
      db.select().from(entraGroupMappingsTable),
    ]);

    const result = apps.map((app) => ({
      ...app,
      groupMappings: mappings.filter((m) => m.applicationId === app.id),
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err, "GET /api/applications/all failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /api/applications ────────────────────────────────────────────────────
router.post("/applications", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as Partial<ApplicationInsert>;
    if (!body.slug || !body.displayName) {
      res.status(400).json({ message: "slug and displayName are required" });
      return;
    }
    const [created] = await db
      .insert(applicationsTable)
      .values({
        slug: body.slug,
        displayName: body.displayName,
        description: body.description ?? null,
        logoUrl: body.logoUrl ?? null,
        url: body.url ?? null,
        healthCheckUrl: body.healthCheckUrl ?? null,
        appInsightsConnectionString: body.appInsightsConnectionString ?? null,
        category: body.category ?? "application",
        tags: body.tags ?? [],
        enabled: body.enabled ?? true,
        createdBy: req.session.user!.id,
      })
      .returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique")) {
      res.status(409).json({ message: "An application with that slug already exists" });
      return;
    }
    req.log.error(err, "POST /api/applications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PUT /api/applications/:id ─────────────────────────────────────────────────
router.put("/applications/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as Partial<ApplicationInsert>;
    const [updated] = await db
      .update(applicationsTable)
      .set({
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
        ...(body.url !== undefined && { url: body.url }),
        ...(body.healthCheckUrl !== undefined && { healthCheckUrl: body.healthCheckUrl }),
        ...(body.appInsightsConnectionString !== undefined && { appInsightsConnectionString: body.appInsightsConnectionString }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        updatedAt: new Date(),
      })
      .where(eq(applicationsTable.id, String(id)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Application not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err, "PUT /api/applications/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── DELETE /api/applications/:id ──────────────────────────────────────────────
router.delete("/applications/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [deleted] = await db
      .delete(applicationsTable)
      .where(eq(applicationsTable.id, String(id)))
      .returning();
    if (!deleted) {
      res.status(404).json({ message: "Application not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/applications/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /api/applications/:id/groups ─────────────────────────────────────────
router.get("/applications/:id/groups", requireAuth, requireAdmin, async (req, res) => {
  try {
    const mappings = await db
      .select()
      .from(entraGroupMappingsTable)
      .where(eq(entraGroupMappingsTable.applicationId, String(req.params.id)));
    res.json(mappings);
  } catch (err) {
    req.log.error(err, "GET /api/applications/:id/groups failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /api/applications/:id/groups ────────────────────────────────────────
router.post("/applications/:id/groups", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { entraGroupId, entraGroupName } = req.body as {
      entraGroupId: string;
      entraGroupName?: string;
    };
    if (!entraGroupId) {
      res.status(400).json({ message: "entraGroupId is required" });
      return;
    }
    const [created] = await db
      .insert(entraGroupMappingsTable)
      .values({
        applicationId: String(id),
        entraGroupId,
        entraGroupName: entraGroupName ?? null,
        createdBy: req.session.user!.id,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err, "POST /api/applications/:id/groups failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── DELETE /api/applications/:id/groups/:mappingId ────────────────────────────
router.delete(
  "/applications/:id/groups/:mappingId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const [deleted] = await db
        .delete(entraGroupMappingsTable)
        .where(eq(entraGroupMappingsTable.id, String(req.params.mappingId)))
        .returning();
      if (!deleted) {
        res.status(404).json({ message: "Group mapping not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      req.log.error(err, "DELETE /api/applications/:id/groups/:mappingId failed");
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default router;
