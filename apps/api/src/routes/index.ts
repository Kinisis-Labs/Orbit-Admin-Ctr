import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import authRouter from "../modules/auth/routes.js";
import healthRouter from "../modules/health/routes.js";
import applicationsRouter from "../modules/applications/routes.js";
import rbacRouter from "../modules/rbac/routes.js";
import usersRouter from "../modules/users/routes.js";
import auditRouter from "../modules/audit/routes.js";
import notificationsRouter from "../modules/notifications/routes.js";
import configRouter from "../modules/config/routes.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(applicationsRouter);
router.use(rbacRouter);
router.use(usersRouter);
router.use(auditRouter);
router.use(notificationsRouter);
router.use(configRouter);

router.use("/admin", requireAuth, requireAdmin, (_req, res) => {
  res.status(501).json({ message: "Admin modules coming in Phase C–H" });
});

export default router;
