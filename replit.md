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
- `lib/db/src/schema` — permanent store content and café inquiries.

## Architecture decisions

- Shopify is the only source of truth for products, variants, stock, discounts, carts, customer purchases and orders. PostgreSQL stores editable website content and café inquiries, not a second commerce ledger.
- Checkout uses the secure Shopify-hosted flow to collect the full address, delivery and payment details and show the order confirmation. The local checkout page is a review/handoff, not a separate payment form.
- Administration requires a verified Clerk email matching the owner-approved `ADMIN_EMAILS` allowlist. Public signup does not confer administrator privileges. Create and verify the approved owner account in `/sign-up` before opening `/admin`.
- Development and production Clerk accounts are separate. The owner must create/verify their approved account in each environment used.

## Product

- Catalogue/detail pages, server-checked Shopify cart, discount entry, guarded checkout, baking instructions, about/policies pages, persistent café inquiry form, protected product/inventory/content/inquiry administration.
- Sales, order management, cancellations, discount creation, shipping regions/rates and payment-provider settings are managed in Shopify through dashboard links, not copied local dashboards.
- Phone-and-order-number tracking is **not enabled**: the current connector does not grant order-reading permissions. The page explains the restriction; buyers use the secure Shopify confirmation/status link. Do not manufacture order histories.

## User preferences

- The user requested a real store, not a design-only prototype.
- Original products: Classic Belgian Cocoa and Kinder Stuffed Cookie. Approved starting price: **10 KWD per bag, 12 cookies per bag**.
- Never invent prices, stock, contact details, delivery fees/areas, payment methods, wholesale prices or policies. Unprovided values remain blank or explicitly awaiting approval.
- Use the supplied logo, baker character, packaging and cookie photos. Brand colours: burgundy `#5B0D1E`, baby pink `#FFD6E5`, white; Playfair Display/Montserrat/Alexandria.
- English by default, Arabic with RTL supported.
- Exact approved baking instructions: preheat to **175°C**, bake at **150°C for 10–12 minutes**, then cool outside the oven.

## Gotchas

- Initial Shopify currency is USD. Display the approved KWD catalogue quote, but block checkout server-side until Shopify currency is KWD and the owner explicitly enables checkout in website settings. Do not silently convert or charge USD.
- Initial stock is zero because actual quantities were not supplied; the owner must enter actual stock before sales.
- Ingredients, policies, public contacts/hours and WhatsApp remain unapproved. WhatsApp appears only when the owner saves a real number.
- Before commercial launch: review KWD prices after changing Shopify currency; configure official inventory, shipping regions/rates, payment gateway and merchant policies in Shopify; fill approved content/contact data; then enable checkout and verify a complete purchase, discount, delivery and confirmation flow.
- No live payments or orders have been tested. Authenticated administration was not exercised through the screenshot browser.
- Publishing is a user action. Do not claim commercial readiness until these owner-controlled prerequisites and a complete purchase verification are finished.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
