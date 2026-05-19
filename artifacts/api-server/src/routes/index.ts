import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gaacRouter from "./gaac";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gaacRouter);

export default router;
