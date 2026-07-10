import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getAiSnapshot } from "../../../lib/ai-monitor.js";

type AiSnapshot = Awaited<ReturnType<typeof getAiSnapshot>>;

const router: IRouter = Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSnapshot: AiSnapshot | null = null;
let cacheExpiresAt = 0;

router.get("/noc/ai", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    if (cachedSnapshot && now < cacheExpiresAt) {
      res.json(cachedSnapshot);
      return;
    }
    const snapshot = await getAiSnapshot();
    cachedSnapshot = snapshot;
    cacheExpiresAt = now + CACHE_TTL_MS;
    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "GET /api/noc/ai failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
