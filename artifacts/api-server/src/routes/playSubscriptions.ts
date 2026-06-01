import { Router, type IRouter } from "express";
import { ListPlaySubscriptionsResponse } from "@workspace/api-zod";
import { getPlaySubscriptions } from "../lib/playSubscriptions";

const router: IRouter = Router();

// Per-app Google Play subscription states + revenue. Serves placeholder figures
// until the keyless Google Play connection is provisioned (see
// lib/playSubscriptions for the config gate + real ingestion seam).
router.get("/play/subscriptions", async (_req, res) => {
  const rows = await getPlaySubscriptions();
  res.json(ListPlaySubscriptionsResponse.parse(rows));
});

export default router;
