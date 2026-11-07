import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "amore-payments-"));
try {
  const outfile = join(temp, "payments.test.cjs");
  await build({
    absWorkingDir: root, entryPoints: ["test/payments/payments.test.ts"], outfile, bundle: true, platform: "node", format: "cjs", logLevel: "warning",
    plugins: [{ name: "isolate-payment-providers", setup(b) {
      b.onResolve({ filter: /\/(catalog|cart|store-settings|shopify-admin-api)$/ }, () => ({ path: join(root, "test/payments/mocks.ts") }));
    } }],
  });
  const child = spawn(process.execPath, ["--test", outfile], {
    stdio: "inherit", env: {
      PATH: process.env.PATH,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code=>resolve(code??1)); });
} finally { await rm(temp, { recursive: true, force: true }); }
