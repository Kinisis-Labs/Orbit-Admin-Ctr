import { Router, type IRouter } from "express";
import { ListUserActivityResponse, GetStaffStatsResponse, ListClerkEventSummaryResponse, ListClerkIdentitiesResponse } from "@workspace/api-zod";
import { getActivity, getClerkEventSummary, getIdentities } from "../lib/clerkActivity";
import { getStaffStats } from "../lib/entraStats";

const router: IRouter = Router();

// Per-app end-user activity, aggregated from Clerk webhook ingestion. Counts
// only — no consumer PII is stored or returned.
router.get("/users/activity", async (_req, res) => {
  const rows = await getActivity();
  res.json(ListUserActivityResponse.parse(rows));
});

// Per-app Clerk user lifecycle event breakdown (signups / updates / deletions).
router.get("/users/clerk-events", async (_req, res) => {
  const rows = await getClerkEventSummary();
  res.json(ListClerkEventSummaryResponse.parse(rows));
});

// Entra ID RBAC group member counts for Orbit groups. Returns
// dataSource="unconfigured" when Entra client creds are absent.
router.get("/users/staff-stats", async (_req, res) => {
  const stats = await getStaffStats();
  res.json(GetStaffStatsResponse.parse(stats));
});

// Individual Clerk user records for a given app (email + account age).
router.get("/users/identities", async (req, res, next) => {
  try {
    const appId = String(req.query.appId ?? "");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    if (!appId) { res.status(400).json({ error: "appId is required" }); return; }
    const rows = await getIdentities(appId, limit, offset);
    res.json(ListClerkIdentitiesResponse.parse(rows));
  } catch (err) {
    next(err);
  }
});

export default router;
