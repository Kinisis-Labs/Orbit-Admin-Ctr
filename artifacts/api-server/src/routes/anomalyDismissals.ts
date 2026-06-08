import { Router, type IRouter } from "express";
import { db, anomalyDismissalsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";

const router: IRouter = Router();

const GLOBAL_SESSION = "__global__";

/**
 * GET /cost/anomaly-dismissals?appId=<id>
 * Returns:
 *   - dismissedDateKeys: union of session-scoped and global dismissals (for backward-compat hide logic)
 *   - globalDismissals:  global-only rows with who dismissed them (for the "Dismissed by X" banner)
 */
router.get("/cost/anomaly-dismissals", async (req, res) => {
  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : undefined;
  if (!appId) {
    res.status(400).json({ error: "appId query parameter is required" });
    return;
  }

  const sessionId = req.session.id;

  const rows = await db
    .select({
      dateKey: anomalyDismissalsTable.dateKey,
      scope: anomalyDismissalsTable.scope,
      dismissedBy: anomalyDismissalsTable.dismissedBy,
    })
    .from(anomalyDismissalsTable)
    .where(
      and(
        eq(anomalyDismissalsTable.appId, appId),
        or(
          eq(anomalyDismissalsTable.sessionId, sessionId),
          eq(anomalyDismissalsTable.sessionId, GLOBAL_SESSION),
        ),
      ),
    );

  const dismissedDateKeys = [...new Set(rows.map((r) => r.dateKey))];

  const globalDismissals = rows
    .filter((r) => r.scope === "global")
    .map((r) => ({ dateKey: r.dateKey, dismissedBy: r.dismissedBy ?? null }));

  res.json({ dismissedDateKeys, globalDismissals });
});

/**
 * POST /cost/anomaly-dismissals
 * Body: { appId: string, dateKey: string, scope?: "session" | "global" }
 * Upserts a dismissal record.
 * When scope is "global", the row is keyed to the "__global__" sentinel session
 * so it is visible to every operator and the unique PK still enforces one global
 * row per (appId, dateKey).
 */
router.post("/cost/anomaly-dismissals", async (req, res) => {
  const { appId, dateKey, scope } = req.body as {
    appId?: unknown;
    dateKey?: unknown;
    scope?: unknown;
  };

  if (typeof appId !== "string" || !appId) {
    res.status(400).json({ error: "appId is required" });
    return;
  }
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    res.status(400).json({ error: "dateKey must be a YYYY-MM-DD date string" });
    return;
  }
  const resolvedScope = scope === "global" ? "global" : "session";

  const sessionId = resolvedScope === "global" ? GLOBAL_SESSION : req.session.id;

  const dismissedBy =
    resolvedScope === "global"
      ? (req.session.user?.displayName ??
         req.session.user?.userPrincipalName ??
         null)
      : null;

  await db
    .insert(anomalyDismissalsTable)
    .values({ sessionId, appId, dateKey, scope: resolvedScope, dismissedBy })
    .onConflictDoNothing();

  res.status(204).end();
});

/**
 * DELETE /cost/anomaly-dismissals?appId=<id>&dateKey=<YYYY-MM-DD>
 * Removes the global ("__global__") dismissal row so the anomaly banner shows
 * again for everyone on the team ("Show again").
 */
router.delete("/cost/anomaly-dismissals", async (req, res) => {
  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : undefined;
  const dateKey = typeof req.query["dateKey"] === "string" ? req.query["dateKey"] : undefined;

  if (!appId) {
    res.status(400).json({ error: "appId query parameter is required" });
    return;
  }
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    res.status(400).json({ error: "dateKey must be a YYYY-MM-DD date string" });
    return;
  }

  await db
    .delete(anomalyDismissalsTable)
    .where(
      and(
        eq(anomalyDismissalsTable.sessionId, GLOBAL_SESSION),
        eq(anomalyDismissalsTable.appId, appId),
        eq(anomalyDismissalsTable.dateKey, dateKey),
      ),
    );

  res.status(204).end();
});

export default router;
