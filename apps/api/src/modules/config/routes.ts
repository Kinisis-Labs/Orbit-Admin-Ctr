import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { globalConfigTable, featureFlagsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";
import { auditFromReq } from "../../lib/audit.js";
import { invalidateConfigCache, invalidateFlagCache } from "../../lib/config.js";

const router = Router();

// ── Global Configuration ───────────────────────────────────────────────────────

// GET /api/config — list all config entries (secret values masked)
router.get("/config", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(globalConfigTable)
      .orderBy(asc(globalConfigTable.key));

    const safe = rows.map((r) => ({
      ...r,
      value: r.isSecret ? "••••••••" : r.value,
    }));

    res.json(safe);
  } catch (err) {
    req.log.error(err, "GET /api/config failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/config — create or update a config entry (upsert by key)
router.post("/config", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      key: string;
      value: string;
      description?: string;
      isSecret?: boolean;
    };
    if (!body.key || body.value === undefined) {
      res.status(400).json({ message: "key and value are required" });
      return;
    }

    const existing = await db
      .select()
      .from(globalConfigTable)
      .where(eq(globalConfigTable.key, body.key))
      .limit(1);

    let result;
    if (existing.length) {
      const [updated] = await db
        .update(globalConfigTable)
        .set({
          value: body.value,
          description: body.description ?? existing[0].description,
          isSecret: body.isSecret ?? existing[0].isSecret,
          updatedBy: req.session.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(globalConfigTable.key, body.key))
        .returning();
      result = updated;
    } else {
      const [created] = await db
        .insert(globalConfigTable)
        .values({
          key: body.key,
          value: body.value,
          description: body.description ?? null,
          isSecret: body.isSecret ?? false,
          updatedBy: req.session.user!.id,
        })
        .returning();
      result = created;
    }

    invalidateConfigCache(body.key);
    void auditFromReq(req, {
      action: "config.set",
      category: "configuration",
      entityType: "config",
      entityId: result.id,
      entityName: body.key,
      detail: { isSecret: result.isSecret },
    });

    res.status(existing.length ? 200 : 201).json({
      ...result,
      value: result.isSecret ? "••••••••" : result.value,
    });
  } catch (err) {
    req.log.error(err, "POST /api/config failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/config/:key — delete a config entry
router.delete("/config/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    await db.delete(globalConfigTable).where(eq(globalConfigTable.key, key));
    invalidateConfigCache(key);
    void auditFromReq(req, { action: "config.delete", category: "configuration", entityType: "config", entityName: key });
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/config/:key failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── Feature Flags ──────────────────────────────────────────────────────────────

// GET /api/config/flags — list all feature flags
router.get("/config/flags", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(featureFlagsTable)
      .orderBy(asc(featureFlagsTable.name));
    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/config/flags failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/config/flags — create or update a feature flag (upsert by name)
router.post("/config/flags", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      name: string;
      enabled: boolean;
      description?: string;
    };
    if (!body.name || body.enabled === undefined) {
      res.status(400).json({ message: "name and enabled are required" });
      return;
    }

    const existing = await db
      .select()
      .from(featureFlagsTable)
      .where(eq(featureFlagsTable.name, body.name))
      .limit(1);

    let result;
    if (existing.length) {
      const [updated] = await db
        .update(featureFlagsTable)
        .set({
          enabled: body.enabled,
          description: body.description ?? existing[0].description,
          updatedBy: req.session.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(featureFlagsTable.name, body.name))
        .returning();
      result = updated;
    } else {
      const [created] = await db
        .insert(featureFlagsTable)
        .values({
          name: body.name,
          enabled: body.enabled,
          description: body.description ?? null,
          updatedBy: req.session.user!.id,
        })
        .returning();
      result = created;
    }

    invalidateFlagCache(body.name);
    void auditFromReq(req, {
      action: body.enabled ? "config.flag.enable" : "config.flag.disable",
      category: "configuration",
      entityType: "feature_flag",
      entityName: body.name,
      detail: { enabled: body.enabled },
    });

    res.status(existing.length ? 200 : 201).json(result);
  } catch (err) {
    req.log.error(err, "POST /api/config/flags failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/config/flags/:name — delete a feature flag
router.delete("/config/flags/:name", requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = String(req.params.name);
    await db.delete(featureFlagsTable).where(eq(featureFlagsTable.name, name));
    invalidateFlagCache(name);
    void auditFromReq(req, { action: "config.flag.delete", category: "configuration", entityType: "feature_flag", entityName: name });
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/config/flags/:name failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
