import { Router, type IRouter } from "express";
import { ListPlaySubscriptionsResponse } from "@workspace/api-zod";
import { getPlaySubscriptions } from "../lib/playSubscriptions.js";
import { getAppConfigFeatureFlag } from "../lib/appConfig.js";
import { requireAuth, requireCostReader } from "../middlewares/auth.js";

const router: IRouter = Router();

// Per-app Google Play subscription states + revenue. Serves placeholder figures
// until the keyless Google Play connection is provisioned (see
// lib/playSubscriptions for the config gate + real ingestion seam).
//
// Feature flag: "play-subscriptions" in App Configuration.
// When the flag is explicitly set to disabled in the store, the endpoint returns
// 404. Falls back to enabled when the flag is absent or the store is unreachable.
router.get("/play/subscriptions", requireAuth, requireCostReader, async (_req, res) => {
  const enabled = await getAppConfigFeatureFlag("play-subscriptions");
  if (!enabled) {
    res.status(404).json({ error: "surface disabled" });
    return;
  }
  const rows = await getPlaySubscriptions();
  res.json(ListPlaySubscriptionsResponse.parse(rows));
});

export default router;
