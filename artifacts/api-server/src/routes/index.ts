import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import orbitRouter from "./orbit";
import ledgerRouter from "./ledger";
import usersRouter from "./users";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public: health + the auth handshake endpoints.
router.use(healthRouter);
router.use(authRouter);

// Protected data routes. In mock mode (no Entra config) requireAuth is a no-op,
// so the dev preview keeps working without sign-in.
router.use(requireAuth, orbitRouter);
router.use(requireAuth, ledgerRouter);
router.use(requireAuth, usersRouter);

export default router;
