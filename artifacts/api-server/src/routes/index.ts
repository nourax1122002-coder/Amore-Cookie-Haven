import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storefrontRouter from "./storefront";
import adminRouter from "./admin";
import paymentsRouter from "./payments";
import assistantRouter from "./assistant";

const router: IRouter = Router();

router.use(healthRouter);
router.use(paymentsRouter);
router.use(assistantRouter);
router.use(storefrontRouter);
router.use(adminRouter);

export default router;
