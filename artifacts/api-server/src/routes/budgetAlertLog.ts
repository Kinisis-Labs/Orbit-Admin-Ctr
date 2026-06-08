import { Router, type IRouter } from "express";
import { db, budgetAlertLogTable } from "@workspace/db";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { APPS } from "./orbit.js";

const router: IRouter = Router();

function toEntry(r: typeof budgetAlertLogTable.$inferSelect, appMap: Map<string, string>) {
  return {
    id: r.id,
    appId: r.appId,
    appName: appMap.get(r.appId) ?? r.appId,
    mtd: Number(r.mtd),
    forecast: Number(r.forecast),
    budget: Number(r.budget),
    channels: r.channels.split(",").filter(Boolean),
    sentAt: r.sentAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
    acknowledgedNote: r.acknowledgedNote ?? null,
    acknowledgedBy: r.acknowledgedBy ?? null,
  };
}

router.get("/budget-alerts/log", async (req, res) => {
  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : undefined;
  const sinceRaw = typeof req.query["since"] === "string" ? req.query["since"] : undefined;
  const sinceDate = sinceRaw ? new Date(sinceRaw) : undefined;
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.ceil(rawLimit), 200) : 50;
  const unacknowledgedOnly = req.query["unacknowledgedOnly"] === "true";

  const appMap = new Map(APPS.map((a) => [a.id, a.name]));

  const whereClause = and(
    appId ? eq(budgetAlertLogTable.appId, appId) : undefined,
    unacknowledgedOnly ? isNull(budgetAlertLogTable.acknowledgedAt) : undefined,
    sinceDate && !isNaN(sinceDate.getTime()) ? gte(budgetAlertLogTable.sentAt, sinceDate) : undefined,
  );

  const rows = await db
    .select()
    .from(budgetAlertLogTable)
    .where(whereClause)
    .orderBy(desc(budgetAlertLogTable.sentAt))
    .limit(limit);

  res.json(rows.map((r) => toEntry(r, appMap)));
});

router.patch("/budget-alerts/log/:id/acknowledge", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const rawNote = req.body?.note;
  const note: string | null =
    typeof rawNote === "string" && rawNote.trim().length > 0
      ? rawNote.trim().slice(0, 500)
      : null;

  const acknowledgedBy =
    req.session.user?.displayName ??
    req.session.user?.userPrincipalName ??
    "mock-admin";

  const appMap = new Map(APPS.map((a) => [a.id, a.name]));

  const updated = await db
    .update(budgetAlertLogTable)
    .set({ acknowledgedAt: new Date(), acknowledgedNote: note, acknowledgedBy })
    .where(eq(budgetAlertLogTable.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  res.json(toEntry(updated[0]!, appMap));
});

export default router;
