import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";
import { getPlatformHealth } from "../../lib/health.js";

const router: IRouter = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/api/health/platform", requireAuth, requireAdmin, async (req, res) => {
  try {
    const report = await getPlatformHealth();
    const statusCode = report.overall === "unhealthy" ? 503 : report.overall === "degraded" ? 207 : 200;
    res.status(statusCode).json(report);
  } catch (err) {
    req.log.error(err, "GET /api/health/platform failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
