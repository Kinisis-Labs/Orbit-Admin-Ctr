import { Router, type IRouter } from "express";
import { db, infraAlertLogTable } from "@workspace/db";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { APPS } from "./orbit.js";

const router: IRouter = Router();

function toEntry(r: typeof infraAlertLogTable.$inferSelect, appMap: Map<string, string>) {
  return {
    id: r.id,
    appId: r.appId,
    appName: appMap.get(r.appId) ?? r.appId,
    metric: r.metric,
    value: Number(r.value),
    threshold: Number(r.threshold),
    channels: r.channels.split(",").filter(Boolean),
    sentAt: r.sentAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
    acknowledgedBy: r.acknowledgedBy ?? null,
  };
}

router.get("/infra-alerts/log", async (req, res) => {
  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : undefined;
  const sinceRaw = typeof req.query["since"] === "string" ? req.query["since"] : undefined;
  const sinceDate = sinceRaw ? new Date(sinceRaw) : undefined;
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.ceil(rawLimit), 200) : 50;
  const unacknowledgedOnly = req.query["unacknowledgedOnly"] === "true";

  const appMap = new Map(APPS.map((a) => [a.id, a.name]));

  const whereClause = and(
    appId ? eq(infraAlertLogTable.appId, appId) : undefined,
    unacknowledgedOnly ? isNull(infraAlertLogTable.acknowledgedAt) : undefined,
    sinceDate && !isNaN(sinceDate.getTime()) ? gte(infraAlertLogTable.sentAt, sinceDate) : undefined,
  );

  const rows = await db
    .select()
    .from(infraAlertLogTable)
    .where(whereClause)
    .orderBy(desc(infraAlertLogTable.sentAt))
    .limit(limit);

  res.json(rows.map((r) => toEntry(r, appMap)));
});

router.patch("/infra-alerts/log/:id/acknowledge", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const appMap = new Map(APPS.map((a) => [a.id, a.name]));

  const acknowledgedBy =
    req.session.user?.displayName ??
    req.session.user?.userPrincipalName ??
    "mock-admin";

  const updated = await db
    .update(infraAlertLogTable)
    .set({ acknowledgedAt: new Date(), acknowledgedBy })
    .where(eq(infraAlertLogTable.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  res.json(toEntry(updated[0]!, appMap));
});

export default router;
