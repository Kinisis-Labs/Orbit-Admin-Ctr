import { Router, type IRouter } from "express";
import { desc, gte } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { db } from "../../../lib/db.js";
import { securityEventsTable, auditLogTable } from "@workspace/db";
import { getSecuritySummary, isGraphConfigured } from "../../../lib/graph-client.js";

const router: IRouter = Router();

router.get("/security", requireAuth, requireAdmin, async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [graphSummary, persistedEvents, recentAudit] = await Promise.all([
      getSecuritySummary(),
      db
        .select()
        .from(securityEventsTable)
        .where(gte(securityEventsTable.createdAt, since24h))
        .orderBy(desc(securityEventsTable.createdAt))
        .limit(50),
      db
        .select()
        .from(auditLogTable)
        .where(gte(auditLogTable.createdAt, since24h))
        .orderBy(desc(auditLogTable.createdAt))
        .limit(25),
    ]);

    if (graphSummary.graphConfigured && graphSummary.failedSignIns.length > 0) {
      const inserts = graphSummary.failedSignIns.slice(0, 10).map((e) => ({
        source: "entra-signin" as const,
        type: "failed-signin",
        severity: "warning",
        userId: e.userPrincipalName,
        userDisplayName: e.userDisplayName,
        ipAddress: e.ipAddress,
        detail: e.status.failureReason ?? `Error code ${e.status.errorCode}`,
      }));
      await db.insert(securityEventsTable).values(inserts).onConflictDoNothing().catch(() => {});
    }

    const auditEvents = recentAudit.map((a) => ({
      id: a.id,
      source: "orbit-audit",
      type: a.action,
      severity: "info",
      userId: a.actorId ?? null,
      userDisplayName: a.actorName ?? a.actorUpn ?? null,
      ipAddress: a.ipAddress ?? null,
      detail: `${a.action}${a.entityType ? ` on ${a.entityType}` : ""}${a.entityId ? ` (${a.entityId})` : ""}`,
      acknowledged: false,
      acknowledgedAt: null,
      createdAt: a.createdAt.toISOString(),
    }));

    res.json({
      graphConfigured: isGraphConfigured(),
      signInSummary: {
        totalSignIns24h: graphSummary.totalSignIns24h,
        failedSignIns24h: graphSummary.failedSignIns.length,
        mfaFailureCount: graphSummary.mfaFailureCount,
      },
      recentSignIns: graphSummary.recentSignIns.slice(0, 10).map((s) => ({
        id: s.id,
        createdAt: s.createdDateTime,
        user: s.userDisplayName,
        upn: s.userPrincipalName,
        ip: s.ipAddress,
        success: s.status.errorCode === 0,
        failureReason: s.status.failureReason ?? null,
      })),
      securityEvents: persistedEvents.map((e) => ({
        id: e.id,
        source: e.source,
        type: e.type,
        severity: e.severity,
        user: e.userDisplayName ?? e.userId ?? null,
        ip: e.ipAddress ?? null,
        detail: e.detail,
        acknowledged: e.acknowledged,
        acknowledgedBy: e.acknowledgedBy ?? null,
        acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
        resolutionNote: e.resolutionNote ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
      auditEvents,
      capturedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error(err, "GET /api/noc/security failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/security/:id/acknowledge", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { eq } = await import("drizzle-orm");
    const id = String(req.params.id);
    const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
    await db
      .update(securityEventsTable)
      .set({
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: req.session.user?.userPrincipalName ?? "admin",
        resolutionNote: note,
      })
      .where(eq(securityEventsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "PATCH /api/noc/security/:id/acknowledge failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/security/:id/resolve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { eq } = await import("drizzle-orm");
    const id = String(req.params.id);
    const by = req.session.user?.userPrincipalName ?? "admin";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
    await db
      .update(securityEventsTable)
      .set({
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: `resolved:${by}`,
        resolutionNote: note,
      })
      .where(eq(securityEventsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "PATCH /api/noc/security/:id/resolve failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
