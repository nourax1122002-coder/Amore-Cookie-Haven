import type { RequestHandler } from "express";

export const CLERK_PROXY_PATH = "/api/__clerk";
export const clerkProxyMiddleware = (): RequestHandler => (_req, _res, next) => next();
export const getClerkProxyHost = () => "auth.example.invalid";
