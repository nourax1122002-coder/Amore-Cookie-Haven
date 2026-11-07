import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

export function sendHealthResponse(_req: Request, res: Response) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.setHeader("Cache-Control", "no-store");
  res.json(data);
}

// The artifact is mounted at /api, so its base path must also be healthy.
router.get("/", sendHealthResponse);
router.get("/healthz", sendHealthResponse);

export default router;
