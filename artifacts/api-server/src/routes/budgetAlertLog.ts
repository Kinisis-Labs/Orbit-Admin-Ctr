import { Router, type IRouter } from "express";
import { db, budgetAlertLogTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { APPS } from "./orbit.js";

const router: IRouter = Router();

router.get("/budget-alerts/log", async (req, res) => {
  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : undefined;
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.ceil(rawLimit), 200) : 50;

  const appMap = new Map(APPS.map((a) => [a.id, a.name]));

  const rows = await db
    .select()
    .from(budgetAlertLogTable)
    .where(appId ? eq(budgetAlertLogTable.appId, appId) : undefined)
    .orderBy(desc(budgetAlertLogTable.sentAt))
    .limit(limit);

  const entries = rows.map((r) => ({
    id: r.id,
    appId: r.appId,
    appName: appMap.get(r.appId) ?? r.appId,
    mtd: Number(r.mtd),
    forecast: Number(r.forecast),
    budget: Number(r.budget),
    channels: r.channels.split(",").filter(Boolean),
    sentAt: r.sentAt.toISOString(),
  }));

  res.json(entries);
});

export default router;
