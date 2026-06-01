import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import orbitRouter from "./orbit";
import ledgerRouter from "./ledger";
import usersRouter from "./users";
import playSubscriptionsRouter from "./playSubscriptions";
import { requireAuth, requireCostReader } from "../middlewares/auth";

const router: IRouter = Router();

// Public: health + the auth handshake endpoints.
router.use(healthRouter);
router.use(authRouter);

// Protected data routes. In mock mode (no Entra config) requireAuth is a no-op,
// so the dev preview keeps working without sign-in.
router.use(requireAuth, orbitRouter);
router.use(requireAuth, ledgerRouter);
router.use(requireAuth, usersRouter);
// Financial surface — gated by the Orbit-Cost-Readers group (FinOps boundary),
// not just UI gating. No-op in mock mode so the dev preview keeps working.
router.use(requireAuth, requireCostReader, playSubscriptionsRouter);

export default router;
