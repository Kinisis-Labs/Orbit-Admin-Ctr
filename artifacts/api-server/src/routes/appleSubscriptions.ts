import { Router, type IRouter } from "express";
import { ListAppleSubscriptionsResponse } from "@workspace/api-zod";
import { getAppleSubscriptions } from "../lib/appleSubscriptions.js";
import { getAppConfigFeatureFlag } from "../lib/appConfig.js";
import { requireAuth, requireCostReader } from "../middlewares/auth.js";

const router: IRouter = Router();

// Per-app Apple App Store subscription states + revenue. Serves placeholder
// figures until the App Store Connect API credentials are provisioned (see
// lib/appleSubscriptions for the config gate + real ingestion seam).
//
// Feature flag: "apple-subscriptions" in App Configuration.
// When the flag is explicitly set to disabled in the store, the endpoint returns
// 404. Falls back to enabled when the flag is absent or the store is unreachable.
router.get("/apple/subscriptions", requireAuth, requireCostReader, async (_req, res) => {
  const enabled = await getAppConfigFeatureFlag("apple-subscriptions");
  if (!enabled) {
    res.status(404).json({ error: "surface disabled" });
    return;
  }
  const rows = await getAppleSubscriptions();
  res.json(ListAppleSubscriptionsResponse.parse(rows));
});

export default router;
