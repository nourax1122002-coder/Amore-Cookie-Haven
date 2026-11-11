# Amore Cookies

Bilingual English/Arabic store for frozen, ready-to-bake cookie dough for homes and cafés in Kuwait.

## Run & Operate

- Use the managed workflows `artifacts/api-server: API Server` and `artifacts/amore-cookies: web`.
- `pnpm --filter @workspace/api-server run dev` — build and run the API server using `PORT`
- `pnpm --filter @workspace/amore-cookies run dev` — run the Vite storefront using `PORT` and `BASE_PATH`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required environment: `SUPABASE_URL` (Supabase project API URL) and `SUPABASE_SECRET_KEY` (server-only key stored in Replit Secrets), `SESSION_SECRET`, `ADMIN_EMAILS` (comma-separated approved administrator emails), managed `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, and the connected Shopify integration. Never put actual secret values in this file.
- Backend Shopify access uses Replit connector runtime authentication. Storefront credentials remain server-side.
- The server uses `@supabase/supabase-js`; its secret key must never enter frontend code. Schema migrations live in `lib/db/migrations` and are applied through the Supabase MCP migration operation. All private tables have RLS enabled and no public policies; runtime access is server-only. Do not run schema changes or destructive seeds on server startup. `SUPABASE_DATABASE_URL` and `DATABASE_URL` are not used by the runtime.
- The connected Supabase organization is currently on the Free plan, which has no scheduled database backups; follow `docs/free-record-recovery.md` for secure manual CSV export and row-level recovery. Never store customer exports in Git or enable paid retention/PITR without owner approval.
- `node scripts/seed-shopify.mjs` is an explicit initial setup operation only. It creates the two approved products, publishes to the Replit channel and starts inventory at zero; already-published products are preserved. Do not make this a startup command.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: Supabase PostgreSQL via server-only Supabase JS (Drizzle schema definitions remain for shared types)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API) and Vite (storefront)

## Where things live

- `artifacts/amore-cookies` — public storefront at `/`, owner dashboard at `/admin`, authentication at `/sign-in` and `/sign-up`.
- `artifacts/api-server/src/routes` — generated-schema-validated API endpoints under `/api`.
- `lib/api-spec/openapi.yaml` — API source of truth; regenerate after contract changes.
- `lib/db/src/schema` — store content, café inquiries, local orders/payment attempts and security counters.

## Architecture decisions

- New checkout uses Stripe Test Mode hosted Checkout through Supabase Edge Functions only. The server calculates KWD totals, saves a durable Supabase order and reserves stock before creating a session. Signed Stripe webhooks control payment, cancellation and refund status; browser redirects and administrator input cannot mark orders paid.
- Reject all live Stripe keys and events. Keep checkout unavailable until the owner confirms account eligibility and supplies test credentials through Supabase Edge Function Secrets. Never ask for keys in chat; never deploy or activate live payments without explicit owner approval.
- The owner approved a flat delivery fee of 3 KWD. Keep the fee editable in protected store settings; do not invent or silently change it.
- Old payment columns and records are retained for history, but no MyFatoorah API, callback, webhook, or checkout path should be active.
- New checkout addresses require an explicitly confirmed delivery point, saved with the existing address JSON and included in payment idempotency. Historical orders may omit coordinates. Precise location belongs only in protected administration, never public receipts/tracking or AI prompts. See `docs/delivery-map.md` for the Leaflet/OSM usage policy and tests.
- The Arabic assistant uses the owner's server-side OpenRouter key directly, not the credit-billed Replit proxy. Preserve zero-price routing, privacy filtering and Supabase-backed shared quotas; never silently switch to paid models or send checkout/order context. See `docs/arabic-assistant.md`.
- Administration requires a verified Clerk email matching the owner-approved `ADMIN_EMAILS` allowlist. Public signup does not confer administrator privileges. Create and verify the approved owner account in `/sign-up` before opening `/admin`.
- Development and production Clerk accounts are separate. The owner must create/verify their approved account in each environment used.

## Product

- Catalogue/detail pages, server-checked Shopify cart, discount entry, guarded checkout, baking instructions, about/policies pages, persistent café inquiry form, protected product/inventory/content/inquiry administration.
- New local orders, delivery address/phone, verified financial status and paid-order delivery-stage updates appear in the protected dashboard. Historical Shopify summaries remain separately readable; the connection does not grant `write_orders`.
- Phone-and-order-number tracking verifies an exact order number against the checkout/shipping phone in Shopify. Responses expose only status, items and totals, never phone/address or privileged confirmation links. Protected-field errors fail closed; buyers can still use their existing Shopify confirmation link. A store with no orders cannot prove protected phone access for a real order.
- Tracking limits share Supabase RPC-backed security-only counters (10/IP/15 minutes and 20/normalized order/hour). Atomic RPCs preserve limits across replicas/restarts; IPs retain IPv6 /56 grouping. Keys are scoped HMACs using the existing `SESSION_SECRET`, which must be present and identical across replicas (rotating it invalidates existing counters). No phones, orders or customer records are retained in counters. Store failure blocks tracking with 503 and Retry-After; throttling keeps 429, Retry-After and no-store. A startup/minute janitor deletes expired counters in bounded batches, even without tracking traffic.
- `pnpm --filter @workspace/api-server run test:orders` checks phone matching, disclosure boundaries and Shopify status mapping without making orders.
- `pnpm run validate` typechecks the project and runs order logic, isolated HTTP security regressions and shared-limiter/quota tests. Stripe domain tests use local fixtures; do not create sample or test orders in the connected Supabase project.
- `pnpm --filter @workspace/api-server run test:admin:http` checks product creation/editing, settings saves and inquiry updates through the real HTTP/security stack with fictional identities, Shopify and database state. It is included in `validate`; no real store settings or products are changed. See `artifacts/api-server/test/admin-http/README.md`.

## User preferences

- The user requested a real store, not a design-only prototype.
- Original products: Classic Belgian Cocoa and Kinder Stuffed Cookie. Approved starting price: **10 KWD per bag, 12 cookies per bag**.
- Never invent prices, stock, contact details, delivery fees/areas, payment methods, wholesale prices or policies. Unprovided values remain blank or explicitly awaiting approval.
- Use the supplied logo, baker character, packaging and cookie photos. Brand colours: burgundy `#5B0D1E`, baby pink `#FFD6E5`, white; Playfair Display/Montserrat/Alexandria.
- English by default, Arabic with RTL supported.
- Exact approved baking instructions: preheat to **175°C**, bake at **150°C for 10–12 minutes**, then cool outside the oven.

## Gotchas

- KWD is the checkout currency; display-only conversions must never alter the server-calculated Stripe test amount or saved order.
- Never reset stock to an initial seed value. Read current Shopify availability and account for durable reservations.
- Ingredients, policies, public contacts/hours and WhatsApp remain unapproved. WhatsApp appears only when the owner saves a real number.
- Before any live launch, review the merchant country and Stripe eligibility, fees, webhook, policies and delivery coverage; obtain explicit owner approval. This code is Test Mode only and must not be presented as production-ready.
- No end-to-end Stripe payment has been tested until Supabase functions, test secrets and a test webhook are configured. Never claim success based on a local build or a browser redirect alone.
- Publishing is a user action. Do not claim commercial readiness until these owner-controlled prerequisites and a complete purchase verification are finished.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
