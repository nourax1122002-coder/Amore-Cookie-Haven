import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { Request, Response } from "express";
import {
  establishSession, getAuthenticatedUserContext, requestPasswordRecovery, signInWithPassword, signOutSession, signUpWithPassword,
} from "../../src/lib/auth";
import { authCalls, resetAuthMock, setAuthMockOutput } from "./mocks/db";

const user = {
  id: "fictional-user-id",
  email: "customer@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { display_name: "Amore Customer" },
};
const session = {
  access_token: "fictional-access-token",
  refresh_token: "fictional-refresh-token",
  expires_in: 3600,
};

function fakeRequest(signedCookies: Record<string, string> = {}) {
  return {
    signedCookies,
    secure: true,
    get: (name: string) => name.toLowerCase() === "x-forwarded-proto" ? "https" : undefined,
  } as unknown as Request;
}

function fakeResponse() {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
  const response = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.push({ name, value, options });
      return response;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cleared.push({ name, options });
      return response;
    },
  } as unknown as Response;
  return { response, cookies, cleared };
}

beforeEach(() => {
  resetAuthMock();
  process.env.ADMIN_EMAILS = "";
});

test("email/password sign-in uses the normalized email and returns the existing Supabase session", async () => {
  setAuthMockOutput("signIn", { data: { user, session }, error: null });

  const result = await signInWithPassword("  CUSTOMER@Example.Invalid ", "fictional-password");

  assert.equal(authCalls.signIn.length, 1);
  assert.deepEqual(authCalls.signIn[0], {
    email: "customer@example.invalid",
    password: "fictional-password",
  });
  assert.equal(result.user.id, user.id);
  assert.equal(result.session.refresh_token, session.refresh_token);
  assert.equal(authCalls.recovery.length, 0, "sign-in must never request password recovery");
});

test("new and already-registered sign-ups preserve Supabase confirmation results without duplicate client-side records", async () => {
  const pendingUser = { ...user, email_confirmed_at: null };
  setAuthMockOutput("signUp", { data: { user: pendingUser, session: null }, error: null });
  const first = await signUpWithPassword(
    " CUSTOMER@Example.Invalid ",
    "fictional-password",
    "Amore Customer",
    "https://amore.example.invalid/sign-in",
  );

  assert.equal(first.user?.id, user.id);
  assert.equal(first.session, null, "email confirmation remains required");
  assert.equal(authCalls.signUp[0]?.email, "customer@example.invalid");
  assert.equal(authCalls.signUp[0]?.options?.emailRedirectTo, "https://amore.example.invalid/sign-in");
  assert.deepEqual(authCalls.signUp[0]?.options?.data, { display_name: "Amore Customer" });

  setAuthMockOutput("signUp", { data: { user: null, session: null }, error: null });
  const duplicate = await signUpWithPassword("customer@example.invalid", "fictional-password", "", undefined);
  assert.equal(duplicate.user, null);
  assert.equal(duplicate.session, null);
  assert.equal(authCalls.signUp.length, 2);
  assert.equal(authCalls.profiles.length, 0, "the sign-up helper must not create duplicate profile rows");
  assert.equal(authCalls.recovery.length, 0, "sign-up must never request password recovery");
});

test("a successful sign-in creates secure HttpOnly cookies and syncs the user's profile", async () => {
  const { response, cookies } = fakeResponse();
  const account = await establishSession(fakeRequest(), response, user, session);

  assert.equal(account.email, user.email);
  assert.equal(account.emailVerified, true);
  assert.equal(account.role, "customer");
  assert.deepEqual(cookies.map(cookie => cookie.name), ["amore_auth_access", "amore_auth_refresh"]);
  assert.ok(cookies.every(cookie => cookie.options.httpOnly === true));
  assert.ok(cookies.every(cookie => cookie.options.signed === true));
  assert.ok(cookies.every(cookie => cookie.options.secure === true));
  assert.equal(authCalls.profiles.length, 1);
  assert.equal(authCalls.profiles[0]?.email, user.email);
});

test("unconfirmed accounts never receive a browser session or profile write", async () => {
  const { response, cookies } = fakeResponse();
  const error = await establishSession(fakeRequest(), response, { ...user, email_confirmed_at: null }, session)
    .then(() => null, cause => cause as { status?: number; message?: string });

  assert.equal(error?.status, 403);
  assert.match(error?.message ?? "", /أكّدي بريدك/);
  assert.equal(cookies.length, 0);
  assert.equal(authCalls.profiles.length, 0);
});

test("an old unconfirmed cookie session is cleared and cannot reach account data", async () => {
  setAuthMockOutput("getUser", { data: { user: { ...user, email_confirmed_at: null } }, error: null });
  const { response, cleared } = fakeResponse();
  const request = fakeRequest({ amore_auth_access: session.access_token });

  const result = await getAuthenticatedUserContext(request, response);

  assert.equal(result, null);
  assert.deepEqual(authCalls.getUser, [session.access_token]);
  assert.deepEqual(cleared.map(cookie => cookie.name), ["amore_auth_access", "amore_auth_refresh"]);
  assert.equal(authCalls.profiles.length, 0);
});

test("logout revokes the current Supabase session and clears only the browser's session cookies", async () => {
  setAuthMockOutput("setSession", { data: { user, session }, error: null });
  const { response, cleared } = fakeResponse();
  const request = fakeRequest({
    amore_auth_access: session.access_token,
    amore_auth_refresh: session.refresh_token,
  });

  await signOutSession(request, response);

  assert.deepEqual(authCalls.signOut, [{ scope: "local" }]);
  assert.deepEqual(cleared.map(cookie => cookie.name), ["amore_auth_access", "amore_auth_refresh"]);
  assert.ok(cleared.every(cookie => cookie.options.path === "/api"));
});

test("password recovery is called only when its explicit request function is invoked", async () => {
  await signInWithPassword("customer@example.invalid", "fictional-password").catch(() => undefined);
  assert.equal(authCalls.recovery.length, 0);

  await requestPasswordRecovery(" CUSTOMER@Example.Invalid ", "https://amore.example.invalid/reset-password");

  assert.deepEqual(authCalls.recovery, [{
    email: "customer@example.invalid",
    options: { redirectTo: "https://amore.example.invalid/reset-password" },
  }]);
});
