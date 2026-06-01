import { Router, type IRouter } from "express";
import { ListUserActivityResponse } from "@workspace/api-zod";
import { getActivity } from "../lib/clerkActivity";

const router: IRouter = Router();

// Per-app end-user activity, aggregated from Clerk webhook ingestion. Counts
// only — no consumer PII is stored or returned.
router.get("/users/activity", async (_req, res) => {
  const rows = await getActivity();
  res.json(ListUserActivityResponse.parse(rows));
});

export default router;
