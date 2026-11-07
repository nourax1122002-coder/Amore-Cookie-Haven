# Order HTTP security regressions

From the repository root:

- `pnpm run validate` — project typechecks plus order, admin-write and shared-limiter suites.
- `pnpm --filter @workspace/api-server run test:orders:http` — HTTP checks only.
- `pnpm --filter @workspace/api-server run test:orders` — existing order logic checks.
- `pnpm --filter @workspace/api-server run test:admin:http` — isolated admin-write
  security checks; see `../admin-http/README.md`.
- `pnpm --filter @workspace/api-server run test:tracking:shared` — shared counter
  contract checks for concurrency, expiry, privacy and failure behavior.

The HTTP suite bundles the actual Express app, routes, authorization policy,
rate limiters, schemas, Shopify transport/response handling, error handler and
production request logging. Requests use a fresh loopback-only server on an
ephemeral port, not the running storefront. Each run starts a fresh process so
limiter state cannot persist between runs; the two limiter tests independently
exercise the IP and normalized-order limits without sleeping or disabling them.

Only external identity/database boundaries are replaced at bundle time. Clerk
returns fictional anonymous, verified visitor, unverified owner and verified
owner identities, while the real `requireAdmin` policy still runs. Database
commerce access throws; a small in-memory repository fake provides security
counters and fault injection for either limiter. The Clerk proxy is disabled in
this test bundle. These tests do
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

## Shared counter contract checks

The separate `test:tracking:shared` suite runs the real limiter middleware with
two independent Express servers and a shared in-memory implementation of the
atomic repository contract used by Supabase RPCs. It verifies cross-instance
limits, HMAC-only key storage and fail-closed behavior without network access or
writes to the connected Supabase project. The isolated HTTP suite also verifies
no Shopify calls on store failure or a missing shared hashing secret, with 503,
Retry-After and no-store.

Merchant first-purchase setup remains outside these suites.
