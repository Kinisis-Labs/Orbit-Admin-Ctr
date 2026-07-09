import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import authRouter from "../modules/auth/routes.js";
import healthRouter from "../modules/health/routes.js";
import applicationsRouter from "../modules/applications/routes.js";
import rbacRouter from "../modules/rbac/routes.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(applicationsRouter);
router.use(rbacRouter);

router.use("/admin", requireAuth, requireAdmin, (_req, res) => {
  res.status(501).json({ message: "Admin modules coming in Phase C–H" });
});

export default router;
