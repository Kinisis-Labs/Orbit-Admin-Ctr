import { Router, type IRouter } from "express";
import healthRouter from "./health";
import orbitRouter from "./orbit";
import ledgerRouter from "./ledger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(orbitRouter);
router.use(ledgerRouter);

export default router;
