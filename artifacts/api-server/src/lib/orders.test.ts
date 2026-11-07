import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhone, phoneMatches } from "./phone";

test("Kuwait phone normalization accepts local, international, and Arabic digits", () => {
  assert.equal(normalizePhone("50000000"), "96550000000");
  assert.equal(normalizePhone("+965 5000 0000"), "96550000000");
  assert.equal(normalizePhone("٥٠٠٠٠٠٠٠"), "96550000000");
  assert.equal(normalizePhone("۵۰۰۰۰۰۰۰"), "96550000000");
});

test("phone comparison rejects invalid or different checkout numbers", () => {
  assert.equal(phoneMatches("50000000", "+96550000000"), true);
  assert.equal(phoneMatches("50000001", "+96550000000"), false);
  assert.equal(phoneMatches("50000000<script>", "+96550000000"), false);
  assert.equal(normalizePhone(""), null);
});
