# Order HTTP security regressions

From the repository root:

- `pnpm run validate` — project typechecks plus both order test suites.
- `pnpm --filter @workspace/api-server run test:orders:http` — HTTP checks only.
- `pnpm --filter @workspace/api-server run test:orders` — existing order logic checks.

The HTTP suite bundles the actual Express app, routes, authorization policy,
rate limiters, schemas, Shopify transport/response handling, error handler and
production request logging. Requests use a fresh loopback-only server on an
ephemeral port, not the running storefront. Each run starts a fresh process so
limiter state cannot persist between runs; the two limiter tests independently
exercise the IP and normalized-order limits without sleeping or disabling them.

Only external identity/database boundaries are replaced at bundle time. Clerk
returns fictional anonymous, verified visitor, unverified owner and verified
owner identities, while the real `requireAdmin` policy still runs. Database
access throws. The Clerk proxy is disabled in this test bundle. These tests do
not verify Clerk token signatures, login or real identity-provider networking.

The runner whitelists child-process environment variables instead of inheriting
credentials. Shopify `fetch` calls must target a fictional hostname and use an
expected read-only order query. The mock returns synthetic orders, protected-data
GraphQL errors (including partial data), HTTP denial or a thrown network error.
No live Shopify, Clerk, database, orders, payments or privileged accounts are used.

Private canaries populate phones, addresses and confirmation tokens/URLs.
Every HTTP response (including headers) and the real Pino output are checked for
these values, and JSON bodies/logs are checked for private field names. The
Pino destination alone is redirected: production logging options and request
serializers are retained. Miss cases compare raw JSON bodies and status codes,
not timestamps or incidental transport headers.

The suite intentionally does not address shared rate-limit storage or merchant
first-purchase setup.
