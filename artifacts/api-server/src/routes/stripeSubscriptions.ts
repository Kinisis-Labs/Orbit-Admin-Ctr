import { Router, type IRouter } from "express";
import { ListStripeSubscriptionsResponse } from "@workspace/api-zod";
import { getStripeSubscriptions } from "../lib/stripeSubscriptions.js";
import { getAppConfigFeatureFlag } from "../lib/appConfig.js";
import { requireAuth, requireCostReader } from "../middlewares/auth.js";

const router: IRouter = Router();

// Per-app Stripe subscription states + revenue. Serves placeholder figures
// until STRIPE_SECRET_KEY is provisioned.
//
// Feature flag: "stripe-subscriptions" in App Configuration.
// When explicitly disabled the endpoint returns 404. Falls back to enabled
// when the flag is absent or the store is unreachable.
router.get("/stripe/subscriptions", requireAuth, requireCostReader, async (_req, res) => {
  const enabled = await getAppConfigFeatureFlag("stripe-subscriptions");
  if (!enabled) {
    res.status(404).json({ error: "surface disabled" });
    return;
  }
  const rows = await getStripeSubscriptions();
  res.json(ListStripeSubscriptionsResponse.parse(rows));
});

export default router;
