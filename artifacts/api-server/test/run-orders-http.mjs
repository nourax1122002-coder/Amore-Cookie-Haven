import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "amore-orders-http-"));
try {
  const outfile = join(temp, "orders-http.test.cjs");
  await build({
    absWorkingDir: root,
    entryPoints: ["test/orders-http/orders-http.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "warning",
    alias: {
      "@clerk/express": join(root, "test/orders-http/mocks/clerk.ts"),
      "@clerk/shared/keys": join(root, "test/orders-http/mocks/clerk-keys.ts"),
      "@workspace/db": join(root, "test/orders-http/mocks/db.ts"),
    },
    plugins: [{
      name: "isolate-clerk-proxy",
      setup(builder) {
        builder.onResolve({ filter: /\/clerkProxyMiddleware$/ }, () => ({
          path: join(root, "test/orders-http/mocks/clerk-proxy.ts"),
        }));
      },
    }],
  });
  // Whitelist rather than inherit: real secrets, accounts and DB URLs never
  // enter the test process. All Shopify fetches are intercepted by the suite.
  const child = spawn(process.execPath, ["--test", outfile], {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      ADMIN_EMAILS: "owner@example.invalid",
      SESSION_SECRET: "fictional-test-session-secret",
      REPLIT_CONNECTORS_HOSTNAME: "shopify.example.invalid",
      REPL_IDENTITY: "fictional-test-identity",
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
