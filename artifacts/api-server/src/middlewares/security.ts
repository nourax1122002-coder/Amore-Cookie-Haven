import type { RequestHandler } from "express";
import { getAuthenticatedUser, approvedAdminEmails } from "../lib/auth";
import { HttpError } from "../lib/errors";

export { approvedAdminEmails };

export async function isAdministrator(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const user = await getAuthenticatedUser(req, res);
  return user?.role === "administrator";
}

export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const user = await getAuthenticatedUser(req, _res);
  if (!user) throw new HttpError(401, "Sign in to continue. / يرجى تسجيل الدخول.");
  if (user.role !== "administrator") throw new HttpError(403, "Administrator access has not been granted. / لم يتم منح صلاحية الإدارة.");
  next();
};

export const sameOrigin: RequestHandler = (req, _res, next) => {
  if (req.method === "POST" && req.path === "/admin/product-images") {
    if (!req.is("image/jpeg") && !req.is("image/png") && !req.is("image/webp")) {
      throw new HttpError(415, "Only JPG, PNG, and WebP product images are supported.");
    }
    next(); return;
  }
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
