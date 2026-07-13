import { Router } from "express";
import { desc, and, eq, ilike, gte, lte, sql } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { auditLogTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";

const router = Router();

// GET /api/audit
// Query params: category, action, actorId, outcome, entityType, from, to, limit, offset, search
router.get("/audit", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      category,
      action,
      actorId,
      outcome,
      entityType,
      from,
      to,
      search,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);
    const offset = parseInt(offsetStr ?? "0", 10);

    const conditions = [];

    if (category) conditions.push(eq(auditLogTable.category, category as never));
    if (outcome) conditions.push(eq(auditLogTable.outcome, outcome as never));
    if (actorId) conditions.push(eq(auditLogTable.actorId, actorId));
    if (entityType) conditions.push(eq(auditLogTable.entityType, entityType));
    if (action) conditions.push(ilike(auditLogTable.action, `%${action}%`));
    if (from) conditions.push(gte(auditLogTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogTable.createdAt, new Date(to)));
    if (search) {
      conditions.push(
        sql`(
          ${auditLogTable.action} ilike ${"%" + search + "%"} OR
          ${auditLogTable.actorName} ilike ${"%" + search + "%"} OR
          ${auditLogTable.actorUpn} ilike ${"%" + search + "%"} OR
          ${auditLogTable.entityName} ilike ${"%" + search + "%"}
        )`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogTable)
        .where(where)
        .orderBy(desc(auditLogTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogTable)
        .where(where),
    ]);

    res.json({
      rows,
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    req.log.error(err, "GET /api/audit failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/audit/:id
router.get("/audit/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.id, String(req.params.id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ message: "Audit record not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error(err, "GET /api/audit/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
