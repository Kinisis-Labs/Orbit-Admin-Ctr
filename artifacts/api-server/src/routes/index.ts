import { Router, type IRouter } from "express";
import healthRouter from "./health";
import orbitRouter from "./orbit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(orbitRouter);

export default router;
