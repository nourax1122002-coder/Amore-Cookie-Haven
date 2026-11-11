import app from "./app";
import { logger } from "./lib/logger";
import { pruneSecurityCounters } from "./lib/tracking-limits";
import { assertSupabaseConfiguration } from "@workspace/db";

// Vercel's Express runtime imports this module and serves the default-exported
// app as a Function. Replit still starts the same app as a persistent server.
export default app;

if (!process.env.VERCEL) {
  assertSupabaseConfiguration();

  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  // Replit runs a persistent service, so its minute-level worker stays intact.
  // Vercel uses the secured daily maintenance route instead of process timers.
  const prune = () => pruneSecurityCounters().catch(() => {
    logger.error({ errorType: "SecurityCounterCleanupFailed" }, "Security counter cleanup failed");
  });
  void prune();
  setInterval(() => { void prune(); }, 60_000).unref();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}
