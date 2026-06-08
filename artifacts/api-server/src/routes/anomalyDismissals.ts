import { Router, type IRouter } from "express";
import { db, anomalyDismissalsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /cost/anomaly-dismissals?appId=<id>
 * Returns the set of anomalous date-keys already dismissed in this session.
 */
router.get("/cost/anomaly-dismissals", async (req, res) => {
  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : undefined;
  if (!appId) {
    res.status(400).json({ error: "appId query parameter is required" });
    return;
  }

  const sessionId = req.session.id;

  const rows = await db
    .select({ dateKey: anomalyDismissalsTable.dateKey })
    .from(anomalyDismissalsTable)
    .where(
      and(
        eq(anomalyDismissalsTable.sessionId, sessionId),
        eq(anomalyDismissalsTable.appId, appId),
      ),
    );

  res.json({ dismissedDateKeys: rows.map((r) => r.dateKey) });
});

/**
 * POST /cost/anomaly-dismissals
 * Body: { appId: string, dateKey: string }
 * Upserts a dismissal record keyed to the current session.
 */
router.post("/cost/anomaly-dismissals", async (req, res) => {
  const { appId, dateKey } = req.body as { appId?: unknown; dateKey?: unknown };

  if (typeof appId !== "string" || !appId) {
    res.status(400).json({ error: "appId is required" });
    return;
  }
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    res.status(400).json({ error: "dateKey must be a YYYY-MM-DD date string" });
    return;
  }

  const sessionId = req.session.id;

  await db
    .insert(anomalyDismissalsTable)
    .values({ sessionId, appId, dateKey })
    .onConflictDoNothing();

  res.status(204).end();
});

export default router;
