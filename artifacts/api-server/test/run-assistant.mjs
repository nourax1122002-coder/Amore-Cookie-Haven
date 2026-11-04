import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const temp = await mkdtemp(join(tmpdir(), "amore-assistant-"));
try {
  const outfile = join(temp, "assistant.test.cjs");
  await build({ entryPoints: ["test/assistant/assistant.test.ts"], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "warning" });
  // Unit tests never inherit the owner's OpenRouter or Clerk credentials.
  const child = spawn(process.execPath, ["--test", outfile], {
    stdio: "inherit", env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
  });
} finally { await rm(temp, { recursive: true, force: true }); }
