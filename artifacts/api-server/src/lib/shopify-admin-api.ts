// All Admin requests use the Replit/OpenInt proxy, never direct Admin tokens.
// Same transport as the canonical shopify-admin-api.mjs helper.
import { HttpError } from "./errors";

export async function shopifyAdminRequest<T = Record<string, any>>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = process.env.REPL_IDENTITY ? `repl ${process.env.REPL_IDENTITY}` :
    process.env.WEB_REPL_RENEWAL ? `depl ${process.env.WEB_REPL_RENEWAL}` : null;
  if (!hostname || !token) throw new HttpError(503, "Shopify integration is not configured.");
  const protocol = hostname.startsWith("localhost") ? "http" : "https";
  const response = await fetch(`${protocol}://${hostname}/api/v2/proxy/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Replit-Token": token, "Connector-Name": "shopify-store" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json() as { data: T; errors?: Array<{ message: string }> };
  if (!response.ok || data.errors?.length) throw new HttpError(502, "Shopify could not complete this request. Please check the store connection and permissions.");
  function checkErrors(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("userErrors" in value) {
      const errors = (value as { userErrors: Array<{ message: string }> }).userErrors;
      if (errors?.length) throw new HttpError(400, errors.map(e => e.message).join(" "));
    }
    for (const v of Object.values(value)) checkErrors(v);
  }
  checkErrors(data.data);
  return data.data;
}
