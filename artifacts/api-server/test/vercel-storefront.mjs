import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";

process.env.VERCEL = "1";
const { default: app } = await import("../index.mjs");
const publicDirectory = resolve("public");
const indexHtml = await readFile(resolve(publicDirectory, "index.html"), "utf8");
const scriptPath = indexHtml.match(/src="([^"]+\.js)"/)?.[1];
const stylePath = indexHtml.match(/href="([^"]+\.css)"/)?.[1];

assert.match(indexHtml, /<title>Amore Cookies<\/title>/);
assert.ok(scriptPath, "Vite JavaScript bundle must be referenced");
assert.ok(stylePath, "Vite stylesheet must be referenced");
assert.ok(scriptPath.startsWith("/"), "Vite assets must use the Vercel root path");
assert.ok(stylePath.startsWith("/"), "Vite assets must use the Vercel root path");

const deployment = express();
deployment.use(express.static(publicDirectory));
deployment.use(app);
const server = deployment.listen(0, "127.0.0.1");

try {
  await new Promise((resolveListening, reject) => {
    server.once("listening", resolveListening);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  for (const route of [
    "/",
    "/products",
    "/products/kinder-stuffed-cookie",
    "/checkout",
    "/sign-in",
  ]) {
    const response = await fetch(new URL(route, baseUrl));
    assert.equal(response.status, 200, `${route} serves the storefront`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /<title>Amore Cookies<\/title>/);
  }

  const script = await fetch(new URL(scriptPath, baseUrl));
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);

  const style = await fetch(new URL(stylePath, baseUrl));
  assert.equal(style.status, 200);
  assert.match(style.headers.get("content-type") ?? "", /text\/css/);

  const logo = await fetch(new URL("/images/amore-logo.png", baseUrl));
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type") ?? "", /image\/png/);

  const health = await fetch(new URL("/api/healthz", baseUrl));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  console.log(
    "Vercel storefront smoke test passed: homepage, SPA routes, static assets, and /api/healthz.",
  );
} finally {
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
