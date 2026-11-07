import assert from "node:assert/strict";
import test from "node:test";
import { mapSupabaseSignInError, mapSupabaseSignUpError } from "./auth-errors";

test("explains Supabase confirmation email quota errors without exposing provider details", () => {
  const error = mapSupabaseSignUpError({
    status: 429,
    code: "over_email_send_rate_limit",
    message: "429: email rate limit exceeded",
  });
  assert.equal(error.status, 429);
  assert.match(error.message, /email quota to reset/i);
  assert.doesNotMatch(error.message, /email rate limit exceeded/i);
});

test("recognizes email throttling even when Supabase omits its error code", () => {
  const error = mapSupabaseSignUpError({ status: 429, message: "email rate limit exceeded" });
  assert.match(error.message, /SMTP/i);
});

test("explains an unconfirmed email when Supabase returns that specific sign-in error", () => {
  const error = mapSupabaseSignInError({
    status: 400,
    code: "email_not_confirmed",
    message: "Email not confirmed",
  });
  assert.equal(error.status, 403);
  assert.match(error.message, /latest Amore message/i);
});

test("keeps other sign-in failures generic to prevent account enumeration", () => {
  const error = mapSupabaseSignInError({
    status: 400,
    code: "invalid_credentials",
    message: "Invalid login credentials",
  });
  assert.equal(error.status, 401);
  assert.match(error.message, /Email or password is incorrect/i);
  assert.doesNotMatch(error.message, /invalid_credentials/i);
});

test("keeps upstream outages distinguishable from credential failures", () => {
  const error = mapSupabaseSignInError({ status: 503, code: "unexpected_failure" });
  assert.equal(error.status, 503);
  assert.match(error.message, /temporarily unavailable/i);
});
