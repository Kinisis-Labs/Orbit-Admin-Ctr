import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getCostSnapshot, type CostSnapshot } from "../../../lib/cost-client.js";

const router: IRouter = Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSnapshot: CostSnapshot | null = null;
let cacheExpiresAt = 0;

router.get("/noc/cost", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    if (cachedSnapshot && now < cacheExpiresAt) {
      res.json(cachedSnapshot);
      return;
    }
    const snapshot = await getCostSnapshot();
    cachedSnapshot = snapshot;
    cacheExpiresAt = now + CACHE_TTL_MS;
    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "GET /api/noc/cost failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
