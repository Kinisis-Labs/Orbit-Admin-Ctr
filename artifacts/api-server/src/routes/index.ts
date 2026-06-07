import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import diagnosticsRouter from "./diagnostics";
import orbitRouter from "./orbit";
import ledgerRouter from "./ledger";
import usersRouter from "./users";
import playSubscriptionsRouter from "./playSubscriptions";
import appleSubscriptionsRouter from "./appleSubscriptions";
import budgetAlertLogRouter from "./budgetAlertLog";
import infraAlertLogRouter from "./infraAlertLog";
import alertsConfigRouter from "./alertsConfig";
import { requireAuth, requireAdmin, requireCostReader } from "../middlewares/auth";

const router: IRouter = Router();

// Public: health + the auth handshake endpoints.
router.use(healthRouter);
router.use(authRouter);

// Diagnostics exposes sensitive config/credential metadata — admin only.
router.use(requireAuth, requireAdmin, diagnosticsRouter);

// Protected data routes.
router.use(requireAuth, orbitRouter);
router.use(requireAuth, ledgerRouter);
router.use(requireAuth, usersRouter);
// Financial surfaces — gated by the Orbit-Cost-Readers group (FinOps boundary),
// not just UI gating. No-op in mock mode so the dev preview keeps working.
router.use(requireAuth, requireCostReader, playSubscriptionsRouter);
router.use(requireAuth, requireCostReader, appleSubscriptionsRouter);
router.use(requireAuth, requireCostReader, budgetAlertLogRouter);
// Infra pressure alerts are operational (not financial) — gated by requireAuth only.
router.use(requireAuth, infraAlertLogRouter);
// Alert threshold config — operational read, gated by requireAuth only.
router.use(requireAuth, alertsConfigRouter);

export default router;
