import app from "./app";
import { logger } from "./lib/logger";
import { pruneSecurityCounters } from "./lib/tracking-limits";

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

// Independent of request traffic; every replica may safely run this janitor.
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
