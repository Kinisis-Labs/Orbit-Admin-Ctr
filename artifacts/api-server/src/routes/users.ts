import { Router, type IRouter } from "express";
import { ListUserActivityResponse, GetStaffStatsResponse } from "@workspace/api-zod";
import { getActivity } from "../lib/clerkActivity";
import { getStaffStats } from "../lib/entraStats";

const router: IRouter = Router();

// Per-app end-user activity, aggregated from Clerk webhook ingestion. Counts
// only — no consumer PII is stored or returned.
router.get("/users/activity", async (_req, res) => {
  const rows = await getActivity();
  res.json(ListUserActivityResponse.parse(rows));
});

// Entra ID RBAC group member counts for Orbit groups. Returns
// dataSource="unconfigured" when Entra client creds are absent.
router.get("/users/staff-stats", async (_req, res) => {
  const stats = await getStaffStats();
  res.json(GetStaffStatsResponse.parse(stats));
});

export default router;
