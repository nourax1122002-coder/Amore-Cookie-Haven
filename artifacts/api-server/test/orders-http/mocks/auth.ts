import type { Request, Response } from "express";

export const approvedAdminEmails = () => (process.env.ADMIN_EMAILS ?? "")
  .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);

export async function getAuthenticatedUser(req: Request, _res: Response) {
  const identity = req.get("x-test-user");
  if (!identity) return null;
  const email = identity === "owner" || identity === "unverified-owner" ? "owner@example.invalid" : "visitor@example.invalid";
  const emailVerified = identity !== "unverified-owner";
  return {
    id: identity,
    email,
    displayName: "",
    emailVerified,
    role: emailVerified && approvedAdminEmails().includes(email) ? "administrator" as const : "customer" as const,
  };
}

export async function establishSession(_req: Request, _res: Response, user: { id: string; email: string }) {
  return { id: user.id, email: user.email, displayName: "", emailVerified: true, role: "customer" as const };
}
export async function signInWithPassword() { throw new Error("Auth is isolated in this test."); }
export async function signUpWithPassword() { throw new Error("Auth is isolated in this test."); }
export async function signOutSession() {}
