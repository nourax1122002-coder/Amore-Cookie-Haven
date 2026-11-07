import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { sameOrigin } from "./middlewares/security";
import { HttpError } from "./lib/errors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sendHealthResponse } from "./routes/health";

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Replit's deployment health probe may reach the service after stripping its
// /api artifact prefix. Keep the service root healthy as well as /api itself.
app.get("/", sendHealthResponse);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.use("/api", sameOrigin);
app.use("/api", (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use("/api", router);

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
