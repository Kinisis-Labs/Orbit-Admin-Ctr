import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import authRouter from "../modules/auth/routes.js";
import healthRouter from "../modules/health/routes.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

router.use("/admin", requireAuth, requireAdmin, (_req, res) => {
  res.status(501).json({ message: "Admin modules coming in Phase B–H" });
});

export default router;
