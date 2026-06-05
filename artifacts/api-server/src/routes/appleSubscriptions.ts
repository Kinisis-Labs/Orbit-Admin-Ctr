import { Router, type IRouter } from "express";
import { ListAppleSubscriptionsResponse } from "@workspace/api-zod";
import { getAppleSubscriptions } from "../lib/appleSubscriptions";

const router: IRouter = Router();

// Per-app Apple App Store subscription states + revenue. Serves placeholder
// figures until the App Store Connect API credentials are provisioned (see
// lib/appleSubscriptions for the config gate + real ingestion seam).
router.get("/apple/subscriptions", async (_req, res) => {
  const rows = await getAppleSubscriptions();
  res.json(ListAppleSubscriptionsResponse.parse(rows));
});

export default router;
