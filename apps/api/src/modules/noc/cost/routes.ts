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
    const forceRefresh = req.query.refresh === "1";
    if (!forceRefresh && cachedSnapshot && now < cacheExpiresAt) {
      res.json(cachedSnapshot);
      return;
    }
    const snapshot = await getCostSnapshot();
    const hasData = snapshot.subscriptions.some((s) => s.totalMtdCost !== null)
      || (snapshot.m365.invoices.length > 0);
    if (hasData) {
      cachedSnapshot = snapshot;
      cacheExpiresAt = now + CACHE_TTL_MS;
    }
    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "GET /api/noc/cost failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
