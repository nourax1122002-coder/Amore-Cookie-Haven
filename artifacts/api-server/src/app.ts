import express, { type Express, type ErrorRequestHandler } from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import { sameOrigin } from "./middlewares/security";
import { HttpError } from "./lib/errors";
import { type IncomingMessage, type ServerResponse } from "http";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sendHealthResponse } from "./routes/health";

const bundledDirectory = (globalThis as typeof globalThis & { __dirname?: string }).__dirname;
const publicDirectoryCandidates = [
  ...(bundledDirectory
    ? [
        { source: "bundle-parent", path: resolve(bundledDirectory, "../public") },
        { source: "bundle-root", path: resolve(bundledDirectory, "public") },
      ]
    : []),
  { source: "working-directory", path: resolve(process.cwd(), "public") },
];
const selectedPublicDirectory =
  publicDirectoryCandidates.find(({ path }) => existsSync(resolve(path, "index.html"))) ??
  publicDirectoryCandidates[0];
const publicDirectory = selectedPublicDirectory.path;
const frontendIndexPath = resolve(publicDirectory, "index.html");

if (process.env.VERCEL) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  logger.info(
    {
      supabaseUrlPresent: Boolean(supabaseUrl),
      supabaseUrlValid: Boolean(supabaseUrl && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)),
      supabaseSecretKeyPresent: Boolean(supabaseSecretKey),
      supabaseSecretKeyFormatValid: Boolean(supabaseSecretKey?.startsWith("sb_secret_")),
    },
    "Supabase runtime configuration status",
  );
  logger.info(
    {
      publicDirectorySource: selectedPublicDirectory.source,
      storefrontIndexPresent: existsSync(frontendIndexPath),
      storefrontAssetsPresent: existsSync(resolve(publicDirectory, "assets")),
      brandLogoPresent: existsSync(resolve(publicDirectory, "logo.svg")),
    },
    "Vercel storefront file status",
  );
}

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
if (process.env.VERCEL) {
  // Serve the generated Vite files from the Function bundle too. This avoids
  // relying on Vercel's static-file routing for files generated during build.
  app.use(express.static(publicDirectory, { index: false, fallthrough: true }));
  app.get("/favicon.ico", (_req, res, next) => {
    res.type("image/svg+xml");
    res.sendFile(resolve(publicDirectory, "logo.svg"), (error) => {
      if (error) next(error);
    });
  });
}
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
  const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : undefined;
  const errorPath = err && typeof err === "object" && "path" in err ? err.path : undefined;
  const missingAsset =
    safeCode === "ENOENT" &&
    typeof errorPath === "string" &&
    errorPath.startsWith(`${publicDirectory}/`)
      ? errorPath.slice(publicDirectory.length + 1)
      : undefined;
  req.log.error({
    errorType: err instanceof Error ? err.name : "Error",
    ...(safeCode ? { errorCode: safeCode } : {}),
    ...(missingAsset ? { missingAsset } : {}),
    method: req.method,
    path: req.path,
  }, "API request failed");
  res.status(503).json({ error: "The store service is temporarily unavailable. Please try again. / خدمة المتجر غير متاحة مؤقتاً. يرجى المحاولة مجدداً." });
};
app.use(errors);
export default app;
