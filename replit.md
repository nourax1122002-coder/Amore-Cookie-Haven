# Amore Cookies

Bilingual English/Arabic store for frozen, ready-to-bake cookie dough for homes and cafés in Kuwait.

## Run & Operate

- Use the managed workflows `artifacts/api-server: API Server` and `artifacts/amore-cookies: web`.
- `pnpm --filter @workspace/api-server run dev` — build and run the API server using `PORT`
- `pnpm --filter @workspace/amore-cookies run dev` — run the Vite storefront using `PORT` and `BASE_PATH`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required environment: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAILS` (comma-separated approved administrator emails), managed `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, and the connected Shopify integration. Never put actual secret values in this file.
- Backend Shopify access uses Replit connector runtime authentication. Storefront credentials remain server-side.
- Database schema is in `lib/db/src/schema`; apply development changes using the development push command above. Do not run schema changes or destructive seeds on server startup.
- `node scripts/seed-shopify.mjs` is an explicit initial setup operation only. It creates the two approved products, publishes to the Replit channel and starts inventory at zero; already-published products are preserved. Do not make this a startup command.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API) and Vite (storefront)

## Where things live

- `artifacts/amore-cookies` — public storefront at `/`, owner dashboard at `/admin`, authentication at `/sign-in` and `/sign-up`.
- `artifacts/api-server/src/routes` — generated-schema-validated API endpoints under `/api`.
- `lib/api-spec/openapi.yaml` — API source of truth; regenerate after contract changes.
- `lib/db/src/schema` — store content, café inquiries, local orders/payment attempts and security counters.

## Architecture decisions

- The owner explicitly chose direct MyFatoorah API payments and locally managed new orders. PostgreSQL is the ledger for these new orders; Shopify remains the source for products, variants, available stock and carts. Historical Shopify orders are preserved separately.
- Checkout creates a durable local order, reserves Shopify availability with idempotent compare-and-set, then redirects to MyFatoorah's official hosted payment page. Server-side payment verification controls paid status; browser redirects and administrator input cannot mark orders paid.
- See `docs/myfatoorah-live-setup.md` for production approval gates, Secrets, webhook V2 configuration, recovery and current limitations. No sandbox fallback or live activation is allowed without owner approval.
- New checkout addresses require an explicitly confirmed delivery point, saved with the existing address JSON and included in payment idempotency. Historical orders may omit coordinates. Precise location belongs only in protected administration, never public receipts/tracking or AI prompts. See `docs/delivery-map.md` for the Leaflet/OSM usage policy and tests.
- The Arabic assistant uses the owner's server-side OpenRouter key directly, not the credit-billed Replit proxy. Preserve zero-price routing, privacy filtering and PostgreSQL shared quotas; never silently switch to paid models or send checkout/order context. See `docs/arabic-assistant.md`.
- Administration requires a verified Clerk email matching the owner-approved `ADMIN_EMAILS` allowlist. Public signup does not confer administrator privileges. Create and verify the approved owner account in `/sign-up` before opening `/admin`.
- Development and production Clerk accounts are separate. The owner must create/verify their approved account in each environment used.

## Product

- Catalogue/detail pages, server-checked Shopify cart, discount entry, guarded checkout, baking instructions, about/policies pages, persistent café inquiry form, protected product/inventory/content/inquiry administration.
- New local orders, delivery address/phone, verified financial status and paid-order delivery-stage updates appear in the protected dashboard. Historical Shopify summaries remain separately readable; the connection does not grant `write_orders`.
- Phone-and-order-number tracking verifies an exact order number against the checkout/shipping phone in Shopify. Responses expose only status, items and totals, never phone/address or privileged confirmation links. Protected-field errors fail closed; buyers can still use their existing Shopify confirmation link. A store with no orders cannot prove protected phone access for a real order.
- Tracking limits share PostgreSQL security-only counters (10/IP/15 minutes and 20/normalized order/hour). Atomic upserts preserve limits across replicas/restarts; IPs retain IPv6 /56 grouping. Keys are scoped HMACs using the existing `SESSION_SECRET`, which must be present and identical across replicas (rotating it invalidates existing counters). No phones, orders or customer records are retained. Store failure/timeout blocks tracking with 503 and Retry-After; throttling keeps 429, Retry-After and no-store. A startup/minute janitor deletes expired counters in bounded batches, even without tracking traffic. Use the normal Drizzle development-schema/post-merge flow for the security table; no startup DDL.
- `pnpm --filter @workspace/api-server run test:orders` checks phone matching, disclosure boundaries and Shopify status mapping without making orders.
- `pnpm run validate` typechecks the project and runs order logic, isolated HTTP security regressions and real-PostgreSQL shared-limiter concurrency checks. The latter requires the development database/schema and `SESSION_SECRET`; it creates and removes only random security-test counters. See `artifacts/api-server/test/orders-http/README.md`; no real orders, payments or accounts are used.
- `pnpm --filter @workspace/api-server run test:admin:http` checks product creation/editing, settings saves and inquiry updates through the real HTTP/security stack with fictional identities, Shopify and database state. It is included in `validate`; no real store settings or products are changed. See `artifacts/api-server/test/admin-http/README.md`.
- `pnpm --filter @workspace/api-server run test:payments` uses isolated gateway/stock mocks and temporary self-cleaning database fixtures. It covers KWD totals, activation gates, signatures, invoice/amount/currency binding, duplicate checkout, stock reservation/release, uncertain API outcomes and monotonic paid status. It never calls a real gateway.

## User preferences

- The user requested a real store, not a design-only prototype.
- Original products: Classic Belgian Cocoa and Kinder Stuffed Cookie. Approved starting price: **10 KWD per bag, 12 cookies per bag**.
- Never invent prices, stock, contact details, delivery fees/areas, payment methods, wholesale prices or policies. Unprovided values remain blank or explicitly awaiting approval.
- Use the supplied logo, baker character, packaging and cookie photos. Brand colours: burgundy `#5B0D1E`, baby pink `#FFD6E5`, white; Playfair Display/Montserrat/Alexandria.
- English by default, Arabic with RTL supported.
- Exact approved baking instructions: preheat to **175°C**, bake at **150°C for 10–12 minutes**, then cool outside the oven.

## Gotchas

- Shopify currency remains independent from direct MyFatoorah payments: charge only the server-approved KWD catalog prices and approved delivery amount, never convert or charge USD. The direct checkout gates and owner checkout switch must all pass before payment starts.
- Never reset stock to an initial seed value. Read current Shopify availability and account for durable reservations.
- Ingredients, policies, public contacts/hours and WhatsApp remain unapproved. WhatsApp appears only when the owner saves a real number.
- Before commercial launch: approve MyFatoorah's merchant account and written fees, configure production Secrets and signed webhook, approve delivery coverage/flat fee and policies, set the actual published origin, then explicitly enable checkout. Existing Shopify discount codes are rejected by direct checkout rather than silently ignored.
- No live payments have been tested. Automated browser checks verified disabled checkout, correct bag quantities/totals, rejected fabricated receipts, and the authenticated local-orders administration UI.
- Publishing is a user action. Do not claim commercial readiness until these owner-controlled prerequisites and a complete purchase verification are finished.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
