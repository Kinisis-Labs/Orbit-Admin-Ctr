import { Router, type IRouter } from "express";
import { db, manualBudgetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireCostReader } from "../middlewares/auth.js";
import { APPS } from "./orbit.js";

const router: IRouter = Router();

/** Virtual apps that exist only for budget tracking (no Azure app record). */
const VIRTUAL_BUDGET_APPS = [
  { id: "microsoft365", name: "Microsoft 365 Applications" },
] as const;

/** All app IDs that are valid targets for a manual budget entry. */
const ALL_BUDGET_APP_IDS = new Set([
  ...APPS.map((a) => a.id),
  ...VIRTUAL_BUDGET_APPS.map((a) => a.id),
]);

function getAppDisplayName(appId: string): string {
  const real = APPS.find((a) => a.id === appId);
  if (real) return real.name;
  const virt = VIRTUAL_BUDGET_APPS.find((a) => a.id === appId);
  if (virt) return virt.name;
  return appId;
}

/** GET /api/budget-management — list all manual budget entries with forecast calculations */
router.get("/budget-management", requireCostReader, async (req, res) => {
  const rows = await db.select().from(manualBudgetsTable);

  const budgetByAppId = new Map(rows.map((r) => [r.appId, r]));

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const elapsedDays = now.getUTCDate();

  const allIds = [
    ...APPS.map((a) => a.id),
    ...VIRTUAL_BUDGET_APPS.map((a) => a.id),
  ];

  const items = allIds.map((appId) => {
    const entry = budgetByAppId.get(appId);
    const monthlyBudget = entry ? parseFloat(entry.monthlyBudget) : null;
    return {
      appId,
      appName: getAppDisplayName(appId),
      monthlyBudget,
      notes: entry?.notes ?? null,
      updatedAt: entry?.updatedAt ?? null,
      updatedBy: entry?.updatedBy ?? null,
      isVirtual: VIRTUAL_BUDGET_APPS.some((v) => v.id === appId),
      meta: {
        daysInMonth,
        elapsedDays,
      },
    };
  });

  res.json(items);
});

/** PUT /api/budget-management/:appId — upsert a manual budget for one app */
router.put("/budget-management/:appId", requireCostReader, async (req, res) => {
  const appId = req.params["appId"] as string;

  if (!ALL_BUDGET_APP_IDS.has(appId)) {
    res.status(404).json({ error: "Unknown app ID" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const rawBudget = body["monthlyBudget"];
  const notes = typeof body["notes"] === "string" ? body["notes"].trim() || null : null;

  const parsed = typeof rawBudget === "number" ? rawBudget : parseFloat(String(rawBudget ?? ""));
  if (isNaN(parsed) || parsed < 0) {
    res.status(400).json({ error: "monthlyBudget must be a non-negative number" });
    return;
  }

  const updatedBy =
    req.session.user?.displayName ??
    req.session.user?.userPrincipalName ??
    null;

  await db
    .insert(manualBudgetsTable)
    .values({
      appId,
      monthlyBudget: parsed.toFixed(2),
      notes,
      updatedAt: new Date(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: manualBudgetsTable.appId,
      set: {
        monthlyBudget: parsed.toFixed(2),
        notes,
        updatedAt: new Date(),
        updatedBy,
      },
    });

  res.json({ ok: true, appId, monthlyBudget: parsed });
});

/** DELETE /api/budget-management/:appId — remove a manual budget entry */
router.delete("/budget-management/:appId", requireCostReader, async (req, res) => {
  const appId = req.params["appId"] as string;

  if (!ALL_BUDGET_APP_IDS.has(appId)) {
    res.status(404).json({ error: "Unknown app ID" });
    return;
  }

  await db.delete(manualBudgetsTable).where(eq(manualBudgetsTable.appId, appId));
  res.json({ ok: true, appId });
});

export default router;
