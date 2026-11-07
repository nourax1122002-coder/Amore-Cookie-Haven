import app from "./app";
import { logger } from "./lib/logger";
import { pruneSecurityCounters } from "./lib/tracking-limits";
import { startPaymentReconciliation } from "./lib/local-orders";
import { databaseConfigurationIssue, databaseTarget } from "@workspace/db";

if (process.env.NODE_ENV === "production" && databaseTarget !== "supabase") {
  throw new Error("A valid SUPABASE_DATABASE_URL is required for the production database.");
}
if (databaseConfigurationIssue) {
  logger.warn("Invalid Supabase database URL; using the existing Replit database for this development run.");
}

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
startPaymentReconciliation();
setInterval(() => { void prune(); }, 60_000).unref();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
