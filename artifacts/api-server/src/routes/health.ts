import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

export function sendHealthResponse(_req: Parameters<IRouter["get"]>[1] extends never ? never : any, res: any) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.setHeader("Cache-Control", "no-store");
  res.json(data);
}

// The artifact is mounted at /api, so its base path must also be healthy.
router.get("/", sendHealthResponse);
router.get("/healthz", sendHealthResponse);

export default router;
