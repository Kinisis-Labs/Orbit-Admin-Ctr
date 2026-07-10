import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getAiSnapshot } from "../../../lib/ai-monitor.js";

const router: IRouter = Router();

router.get("/noc/ai", requireAuth, requireAdmin, async (req, res) => {
  try {
    const snapshot = await getAiSnapshot();
    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "GET /api/noc/ai failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
