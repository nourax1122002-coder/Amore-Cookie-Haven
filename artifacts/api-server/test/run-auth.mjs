import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "amore-auth-"));
try {
  const outfile = join(temp, "auth.test.cjs");
  await build({
    absWorkingDir: root,
    entryPoints: ["test/auth/auth.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "warning",
    alias: { "@workspace/db": join(root, "test/auth/mocks/db.ts") },
  });
  const child = spawn(process.execPath, ["--test", outfile], {
    stdio: "inherit",
    env: { PATH: process.env.PATH, NODE_ENV: "test", ADMIN_EMAILS: "" },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
