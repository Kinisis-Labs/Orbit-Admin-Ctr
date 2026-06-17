import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import diagnosticsRouter from "./diagnostics";
import orbitRouter, { debugRouter } from "./orbit";
import ledgerRouter from "./ledger";
import usersRouter from "./users";
import playSubscriptionsRouter from "./playSubscriptions";
import appleSubscriptionsRouter from "./appleSubscriptions";
import stripeSubscriptionsRouter from "./stripeSubscriptions";
import budgetAlertLogRouter from "./budgetAlertLog";
import infraAlertLogRouter from "./infraAlertLog";
import alertsConfigRouter from "./alertsConfig";
import anomalyDismissalsRouter from "./anomalyDismissals";
import alertSseRouter from "./alertSse";
import featureFlagsRouter from "./featureFlags";
import tagComplianceRouter from "./tagCompliance";
import { requireAuth, requireCostReader } from "../middlewares/auth";

const router: IRouter = Router();

// Public: health + the auth handshake endpoints.
router.use(healthRouter);
router.use(authRouter);
// Debug diagnostic endpoints — auth-gated so raw Azure data is not publicly accessible.
router.use(requireAuth, debugRouter);
// Diagnostics: admin gate is applied inside diagnosticsRouter on its specific route.
router.use(requireAuth, diagnosticsRouter);

// Protected data routes.
router.use(requireAuth, orbitRouter);
router.use(requireAuth, ledgerRouter);
router.use(requireAuth, usersRouter);
// Financial surfaces — gated by the Orbit-Cost-Readers group (FinOps boundary),
// not just UI gating. No-op in mock mode so the dev preview keeps working.
router.use(requireAuth, requireCostReader, playSubscriptionsRouter);
router.use(requireAuth, requireCostReader, appleSubscriptionsRouter);
router.use(requireAuth, requireCostReader, stripeSubscriptionsRouter);
router.use(requireAuth, requireCostReader, budgetAlertLogRouter);
// Infra pressure alerts are operational (not financial) — gated by requireAuth only.
router.use(requireAuth, infraAlertLogRouter);
// Alert threshold config — operational read, gated by requireAuth only.
router.use(requireAuth, alertsConfigRouter);
// Anomaly dismissals — cost surface, but dismissal itself is operational (not financial).
router.use(requireAuth, anomalyDismissalsRouter);
// SSE stream for instant alert push — gated by requireAuth only (stream carries no data, just a signal).
router.use(requireAuth, alertSseRouter);
// Feature flag admin — requireAdmin is enforced inside the router on each route.
router.use(featureFlagsRouter);
// Tag compliance scan — requireAuth only (operational, not financial).
router.use(requireAuth, tagComplianceRouter);

export default router;
