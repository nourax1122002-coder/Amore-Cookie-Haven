import test from "node:test";
import assert from "node:assert/strict";
import { uploadAdminProductImage } from "./admin-product-image-upload.ts";

const path = "00000000-0000-4000-8000-000000000123.webp";
const signingUrl = `https://amore-project.supabase.co/storage/v1/object/upload/sign/amore-products/${path}?token=fictional`;
const imageUrl = `https://amore-project.supabase.co/storage/v1/object/public/amore-products/${path}`;

function response(body, ok = true) {
  return { ok, json: async () => body };
}

test("admin image upload requests a scoped signed URL and then uploads directly", async () => {
  const calls = [];
  const file = new Blob(["fictional image bytes"], { type: "image/webp" });
  Object.defineProperty(file, "name", { value: "cookie.webp" });
  const fetcher = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) return response({ uploadUrl: signingUrl, imageUrl });
    return response({});
  };

  assert.equal(await uploadAdminProductImage(file, fetcher), imageUrl);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].input, "/api/admin/product-images/sign");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0].init.body), { contentType: "image/webp" });
  assert.equal(calls[1].input, signingUrl);
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.credentials, "omit");
  assert.equal(calls[1].init.headers["Content-Type"], "image/webp");
});

test("admin image upload rejects an untrusted signed destination", async () => {
  const file = new Blob(["fictional image bytes"], { type: "image/png" });
  const fetcher = async () => response({
    uploadUrl: "https://attacker.example/upload?token=not-safe",
    imageUrl: "https://attacker.example/image.png",
  });
  await assert.rejects(() => uploadAdminProductImage(file, fetcher), /Could not prepare/);
});

test("admin image upload keeps the five megabyte validation", async () => {
  const file = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" });
  let called = false;
  await assert.rejects(() => uploadAdminProductImage(file, async () => {
    called = true;
    return response({});
  }), /up to 5 MB/);
  assert.equal(called, false);
});
