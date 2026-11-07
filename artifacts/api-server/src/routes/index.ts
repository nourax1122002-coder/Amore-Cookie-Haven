import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storefrontRouter from "./storefront";
import adminRouter from "./admin";
import paymentsRouter from "./payments";
import assistantRouter from "./assistant";
import authRouter from "./auth";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(paymentsRouter);
router.use(assistantRouter);
router.use(authRouter);
router.use(accountRouter);
router.use(storefrontRouter);
router.use(adminRouter);

export default router;
