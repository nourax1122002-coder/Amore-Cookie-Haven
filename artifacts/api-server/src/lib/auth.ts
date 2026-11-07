import type { Request, Response } from "express";
import { createSupabaseAuthClient, saveUserProfile, type UserProfileRecord } from "@workspace/db";
import { HttpError } from "./errors";

const ACCESS_COOKIE = "amore_auth_access";
const REFRESH_COOKIE = "amore_auth_refresh";
const COOKIE_PATH = "/api";
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

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

export const approvedAdminEmails = () => (process.env.ADMIN_EMAILS ?? "")
  .split(",").map(email => email.trim().toLowerCase()).filter(Boolean);

function cookieOptions(req: Request, maxAge: number) {
  return {
    httpOnly: true,
    signed: true,
    sameSite: "lax" as const,
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    path: COOKIE_PATH,
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
  if (!resolvedAccessToken) throw authServiceUnavailable();
  return { user: await accountFromUser(user), accessToken: resolvedAccessToken };
}

export async function signInWithPassword(email: string, password: string) {
  const result = await createSupabaseAuthClient().auth.signInWithPassword({ email, password });
  if (result.error) {
    if ((result.error.status ?? 0) === 429) throw new HttpError(429, "Too many attempts. Please wait before trying again. / محاولات كثيرة. يرجى الانتظار قبل المحاولة مجدداً.");
    if ((result.error.status ?? 0) >= 500) throw authServiceUnavailable();
    throw new HttpError(401, "Email or password is incorrect. / البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  }
  if (!result.data.session || !result.data.user) throw authServiceUnavailable();
  return result.data;
}

export async function establishSession(req: Request, res: Response, user: AuthUser, session: AuthSession) {
  setSessionCookies(req, res, session);
  return accountFromUser(user);
}

export async function signUpWithPassword(email: string, password: string, displayName: string, emailRedirectTo?: string) {
  const result = await createSupabaseAuthClient().auth.signUp({
    email, password, options: { data: { display_name: displayName }, ...(emailRedirectTo ? { emailRedirectTo } : {}) },
  });
  if (result.error) {
    if ((result.error.status ?? 0) === 429) throw new HttpError(429, "Too many attempts. Please wait before trying again. / محاولات كثيرة. يرجى الانتظار قبل المحاولة مجدداً.");
    if ((result.error.status ?? 0) >= 500) throw authServiceUnavailable();
    throw new HttpError(400, "Please check your email and password. / يرجى التحقق من البريد الإلكتروني وكلمة المرور.");
  }
  return result.data;
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
