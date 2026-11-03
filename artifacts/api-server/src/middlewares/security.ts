import type { RequestHandler } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { HttpError } from "../lib/errors";

export const approvedAdminEmails = () => (process.env.ADMIN_EMAILS ?? "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

export async function isAdministrator(req: Parameters<RequestHandler>[0]) {
  const { userId } = getAuth(req);
  if (!userId) return false;
  const user = await clerkClient.users.getUser(userId);
  // Only verified, owner-approved identities. Signup never grants privileges.
  return user.emailAddresses.some(e =>
    e.verification?.status === "verified" && approvedAdminEmails().includes(e.emailAddress.toLowerCase()));
}

export const requireAdmin: RequestHandler = async (req, _res, next) => {
  if (!getAuth(req).userId) throw new HttpError(401, "Sign in to continue. / يرجى تسجيل الدخول.");
  if (!await isAdministrator(req)) throw new HttpError(403, "Administrator access has not been granted. / لم يتم منح صلاحية الإدارة.");
  next();
};

export const sameOrigin: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0]?.trim();
  if (origin) {
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { /* reject below */ }
    if (!host || originHost !== host) throw new HttpError(403, "Cross-site request rejected.");
  }
  // JSON-only writes prevent cross-origin form POSTs and simple content-type CSRF.
  if (!req.is("application/json")) throw new HttpError(415, "Send application/json.");
  next();
};
