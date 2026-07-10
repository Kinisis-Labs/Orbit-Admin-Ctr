import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getCostSnapshot } from "../../../lib/cost-client.js";

const router: IRouter = Router();

router.get("/noc/cost", requireAuth, requireAdmin, async (req, res) => {
  try {
    const snapshot = await getCostSnapshot();
    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "GET /api/noc/cost failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
