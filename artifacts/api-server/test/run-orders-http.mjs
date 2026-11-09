import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const suite = process.argv[2] ?? "orders-http";
if (!["orders-http", "admin-http"].includes(suite)) throw new Error("Unknown HTTP suite");
const temp = await mkdtemp(join(tmpdir(), `amore-${suite}-`));
try {
  const outfile = join(temp, `${suite}.test.cjs`);
  await build({
    absWorkingDir: root,
    entryPoints: [`test/${suite}/${suite}.test.ts`],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "warning",
    alias: {
      "@workspace/db": join(root, `test/${suite}/mocks/db.ts`),
    },
    plugins: [{
      name: "isolate-auth",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/lib\/auth$/ }, () => ({
          path: join(root, "test/orders-http/mocks/auth.ts"),
        }));
      },
    }],
  });
  // Whitelist only fictional identity values. No real account or database
  // credentials enter the test process; unexpected network access fails tests.
  const child = spawn(process.execPath, ["--test", outfile], {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      ADMIN_EMAILS: "owner@example.invalid",
      SESSION_SECRET: "fictional-test-session-secret",
      CRON_SECRET: "fictional-test-cron-secret",
      SUPABASE_URL: "https://amore-project.supabase.co",
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
