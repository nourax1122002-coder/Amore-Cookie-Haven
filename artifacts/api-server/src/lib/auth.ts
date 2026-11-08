import type { Request, Response } from "express";
import { createSupabaseAuthClient, saveUserProfile, type UserProfileRecord } from "@workspace/db";
import { HttpError } from "./errors";
import { emailNotConfirmedError, mapSupabaseSignInError, mapSupabaseSignUpError } from "./auth-errors";

const ACCESS_COOKIE = "amore_auth_access";
const REFRESH_COOKIE = "amore_auth_refresh";
const RECOVERY_ACCESS_COOKIE = "amore_password_recovery_access";
const RECOVERY_REFRESH_COOKIE = "amore_password_recovery_refresh";
const COOKIE_PATH = "/api";
const RECOVERY_COOKIE_PATH = "/api/auth";
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_MAX_AGE = 10 * 60 * 1000;

export type AmoreAccount = {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  role: UserProfileRecord["role"];
};
type AuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
};
type AuthSession = { access_token: string; refresh_token: string; expires_in?: number };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const approvedAdminEmails = () => (process.env.ADMIN_EMAILS ?? "")
  .split(",").map(email => email.trim().toLowerCase()).filter(Boolean);

function cookieOptions(req: Request, maxAge: number, path = COOKIE_PATH) {
  return {
    httpOnly: true,
    signed: true,
    sameSite: "lax" as const,
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    path,
    maxAge,
  };
}

function setSessionCookies(req: Request, res: Response, session: AuthSession) {
  const maxAge = Math.max(60_000, Math.min(3_600_000, (session.expires_in ?? 3600) * 1000));
  res.cookie(ACCESS_COOKIE, session.access_token, cookieOptions(req, maxAge));
  res.cookie(REFRESH_COOKIE, session.refresh_token, cookieOptions(req, REFRESH_MAX_AGE));
}

function clearSessionCookies(req: Request, res: Response) {
  const options = { ...cookieOptions(req, 0), expires: new Date(0) };
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}

function setRecoveryCookies(req: Request, res: Response, session: AuthSession) {
  const options = cookieOptions(req, RECOVERY_MAX_AGE, RECOVERY_COOKIE_PATH);
  res.cookie(RECOVERY_ACCESS_COOKIE, session.access_token, options);
  res.cookie(RECOVERY_REFRESH_COOKIE, session.refresh_token, options);
}

function clearRecoveryCookies(req: Request, res: Response) {
  const options = { ...cookieOptions(req, 0, RECOVERY_COOKIE_PATH), expires: new Date(0) };
  res.clearCookie(RECOVERY_ACCESS_COOKIE, options);
  res.clearCookie(RECOVERY_REFRESH_COOKIE, options);
}

async function accountFromUser(user: AuthUser): Promise<AmoreAccount> {
  const email = user.email?.trim().toLowerCase() ?? "";
  const emailVerified = Boolean(user.email_confirmed_at);
  const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "";
  const role = emailVerified && approvedAdminEmails().includes(email) ? "administrator" : "customer";
  const profile = await saveUserProfile({ userId: user.id, email, displayName, role });
  return {
    id: user.id, email, displayName: profile.displayName,
    emailVerified, role: profile.role,
  };
}

function authServiceUnavailable() {
  return new HttpError(503, "Account service is temporarily unavailable. Please retry. / خدمة الحسابات غير متاحة مؤقتاً. يرجى المحاولة مجدداً.");
}

export async function getAuthenticatedUser(req: Request, res: Response): Promise<AmoreAccount | null> {
  const context = await getAuthenticatedUserContext(req, res);
  return context?.user ?? null;
}

export async function getAuthenticatedUserContext(req: Request, res: Response): Promise<{ user: AmoreAccount; accessToken: string } | null> {
  const accessToken = req.signedCookies?.[ACCESS_COOKIE];
  const refreshToken = req.signedCookies?.[REFRESH_COOKIE];
  if (!accessToken && !refreshToken) return null;
  const auth = createSupabaseAuthClient();
  let user: AuthUser | null = null;
  let resolvedAccessToken = typeof accessToken === "string" ? accessToken : "";
  if (typeof accessToken === "string") {
    const result = await auth.auth.getUser(accessToken);
    if (!result.error && result.data.user) user = result.data.user;
    else if (result.error && (result.error.status ?? 0) >= 500) throw authServiceUnavailable();
  }
  if (!user && typeof refreshToken === "string") {
    const refreshed = await auth.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.error) {
      if ((refreshed.error.status ?? 0) >= 500) throw authServiceUnavailable();
      clearSessionCookies(req, res);
      return null;
    }
    if (refreshed.data.session && refreshed.data.user) {
      setSessionCookies(req, res, refreshed.data.session);
      user = refreshed.data.user;
      resolvedAccessToken = refreshed.data.session.access_token;
    }
  }
  if (!user) {
    clearSessionCookies(req, res);
    return null;
  }
  if (!user.email_confirmed_at) {
    clearSessionCookies(req, res);
    return null;
  }
  if (!resolvedAccessToken) throw authServiceUnavailable();
  return { user: await accountFromUser(user), accessToken: resolvedAccessToken };
}

export async function signInWithPassword(email: string, password: string) {
  const result = await createSupabaseAuthClient().auth.signInWithPassword({ email: normalizeEmail(email), password });
  if (result.error) throw mapSupabaseSignInError(result.error);
  if (!result.data.session || !result.data.user) throw authServiceUnavailable();
  return result.data;
}

export async function establishSession(req: Request, res: Response, user: AuthUser, session: AuthSession) {
  if (!user.email_confirmed_at) throw emailNotConfirmedError();
  const account = await accountFromUser(user);
  setSessionCookies(req, res, session);
  return account;
}

export async function signUpWithPassword(email: string, password: string, displayName: string, emailRedirectTo?: string) {
  const result = await createSupabaseAuthClient().auth.signUp({
    email: normalizeEmail(email), password,
    options: { data: { display_name: displayName }, ...(emailRedirectTo ? { emailRedirectTo } : {}) },
  });
  if (result.error) throw mapSupabaseSignUpError(result.error);
  return result.data;
}

export async function resendSignupConfirmation(email: string, emailRedirectTo?: string) {
  const result = await createSupabaseAuthClient().auth.resend({
    type: "signup",
    email: normalizeEmail(email),
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (result.error) throw mapSupabaseSignUpError(result.error);
}

export async function requestPasswordRecovery(email: string, redirectTo?: string) {
  const result = await createSupabaseAuthClient().auth.resetPasswordForEmail(
    normalizeEmail(email),
    redirectTo ? { redirectTo } : undefined,
  );
  if (result.error) throw mapSupabaseSignUpError(result.error);
}

export async function establishRecoverySession(
  req: Request,
  res: Response,
  accessToken: string,
  refreshToken: string,
) {
  const auth = createSupabaseAuthClient();
  const result = await auth.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (result.error || !result.data.session || !result.data.user) {
    throw new HttpError(
      400,
      "This password-reset link is invalid or has expired. Request a new one. / رابط استعادة كلمة المرور غير صالح أو انتهت صلاحيته. اطلبي رابطاً جديداً.",
    );
  }
  setRecoveryCookies(req, res, result.data.session);
}

export async function updatePasswordFromRecovery(req: Request, res: Response, password: string) {
  const accessToken = req.signedCookies?.[RECOVERY_ACCESS_COOKIE];
  const refreshToken = req.signedCookies?.[RECOVERY_REFRESH_COOKIE];
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new HttpError(
      401,
      "Open the password-reset link from your email again. / افتحي رابط استعادة كلمة المرور من بريدك الإلكتروني مجدداً.",
    );
  }

  const auth = createSupabaseAuthClient();
  const session = await auth.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (session.error || !session.data.session || !session.data.user) {
    clearRecoveryCookies(req, res);
    throw new HttpError(
      401,
      "This password-reset link is invalid or has expired. Request a new one. / رابط استعادة كلمة المرور غير صالح أو انتهت صلاحيته. اطلبي رابطاً جديداً.",
    );
  }

  const result = await auth.auth.updateUser({ password });
  if (result.error) {
    if ((result.error.status ?? 0) >= 500) throw authServiceUnavailable();
    throw new HttpError(
      400,
      "Supabase could not accept this password. Choose a different password and try again. / لم يقبل Supabase كلمة المرور. اختاري كلمة مرور مختلفة وحاولي مجدداً.",
    );
  }
  clearRecoveryCookies(req, res);
}

export async function signOutSession(req: Request, res: Response) {
  const accessToken = req.signedCookies?.[ACCESS_COOKIE];
  const refreshToken = req.signedCookies?.[REFRESH_COOKIE];
  if (typeof accessToken === "string" && typeof refreshToken === "string") {
    const auth = createSupabaseAuthClient();
    try {
      const session = await auth.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (session.data.session) await auth.auth.signOut({ scope: "local" });
    } catch {
      // Clearing the browser cookies still removes this device's local session.
    }
  }
  clearSessionCookies(req, res);
}
