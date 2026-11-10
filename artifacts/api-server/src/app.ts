import express, { type Express, type ErrorRequestHandler } from "express";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import { sameOrigin } from "./middlewares/security";
import { HttpError } from "./lib/errors";
import { type IncomingMessage, type ServerResponse } from "http";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sendHealthResponse } from "./routes/health";

// Vercel's project root is artifacts/api-server, where its public assets live.
const frontendIndexPath = resolve(process.cwd(), "public/index.html");

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Replit's deployment health probe may reach the service after stripping its
// /api artifact prefix. Keep the service root healthy as well as /api itself.
const sendFrontend = (
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  res.sendFile(frontendIndexPath, (error) => {
    if (error) next(error);
  });
};
app.get("/", process.env.VERCEL ? sendFrontend : sendHealthResponse);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.use("/api", sameOrigin);
app.use("/api", (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use("/api", router);

if (process.env.VERCEL) {
  app.get(/.*/, (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    sendFrontend(req, res, next);
  });
}

const errors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
  if (err?.name === "ZodError" || err instanceof SyntaxError) {
    res.status(400).json({ error: "Please check the submitted fields. / يرجى التحقق من البيانات المدخلة." }); return;
  }
  // Do not log request bodies, upstream payloads, customer PII or secrets.
  req.log.error({ errorType: err?.name ?? "Error" }, "API request failed");
  res.status(503).json({ error: "The store service is temporarily unavailable. Please try again. / خدمة المتجر غير متاحة مؤقتاً. يرجى المحاولة مجدداً." });
};
app.use(errors);
export default app;
