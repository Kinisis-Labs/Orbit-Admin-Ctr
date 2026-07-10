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
import nocInfraRouter from "../modules/noc/infrastructure/routes.js";
import nocAppsRouter from "../modules/noc/applications/routes.js";
import nocSecurityRouter from "../modules/noc/security/routes.js";
import nocAiRouter from "../modules/noc/ai/routes.js";
import nocDiagRouter from "../modules/noc/diag/routes.js";
import nocIncidentsRouter from "../modules/noc/incidents/routes.js";
import nocUxRouter from "../modules/noc/ux/routes.js";
import nocApiDepsRouter from "../modules/noc/api-dependencies/routes.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(applicationsRouter);
router.use(rbacRouter);
router.use(usersRouter);
router.use(auditRouter);
router.use(notificationsRouter);
router.use(configRouter);
router.use("/noc", nocInfraRouter);
router.use("/noc", nocAppsRouter);
router.use("/noc", nocSecurityRouter);
router.use("/noc", nocAiRouter);
router.use("/noc", nocDiagRouter);
router.use("/noc", nocIncidentsRouter);
router.use("/noc", nocUxRouter);
router.use("/noc", nocApiDepsRouter);

router.use("/admin", requireAuth, requireAdmin, (_req, res) => {
  res.status(501).json({ message: "Admin modules coming in Phase C–H" });
});

export default router;
