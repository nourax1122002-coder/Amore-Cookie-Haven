import type { Request, RequestHandler } from "express";

// Only the test bundle resolves Clerk here. Production auth is never changed.
export const clerkMiddleware = (): RequestHandler => (_req, _res, next) => next();
export const getAuth = (req: Request) => ({ userId: req.get("x-test-user") ?? null });
export const clerkClient = {
  users: {
    async getUser(id: string) {
      return {
        emailAddresses: [{
          emailAddress: id === "owner" || id === "unverified-owner"
            ? "owner@example.invalid" : "visitor@example.invalid",
          verification: { status: id === "unverified-owner" ? "unverified" : "verified" },
        }],
      };
    },
  },
};
