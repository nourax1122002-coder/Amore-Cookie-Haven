# Order HTTP security regressions

From the repository root:

- `pnpm run validate` — project typechecks plus order and shared-limiter suites.
- `pnpm --filter @workspace/api-server run test:orders:http` — HTTP checks only.
- `pnpm --filter @workspace/api-server run test:orders` — existing order logic checks.
- `pnpm --filter @workspace/api-server run test:tracking:shared` — real PostgreSQL
  concurrency, replacement-instance persistence, expiry, privacy and failure checks.

The HTTP suite bundles the actual Express app, routes, authorization policy,
rate limiters, schemas, Shopify transport/response handling, error handler and
production request logging. Requests use a fresh loopback-only server on an
ephemeral port, not the running storefront. Each run starts a fresh process so
limiter state cannot persist between runs; the two limiter tests independently
exercise the IP and normalized-order limits without sleeping or disabling them.

Only external identity/database boundaries are replaced at bundle time. Clerk
returns fictional anonymous, verified visitor, unverified owner and verified
owner identities, while the real `requireAdmin` policy still runs. Database
commerce access throws; a small in-memory SQL-boundary fake provides security
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

## Shared PostgreSQL limiter checks

The separate `test:tracking:shared` suite runs the real limiter middleware and SQL
against two independent PostgreSQL connections and Express servers, including
simultaneous requests competing for the same IP/order budget. Additional limiter
instances see the existing budget rather than resetting it. It checks IPv6 /56
grouping, unchanged active expiry, atomic reset after expiry, physical cleanup
(without removing active counters), HMAC-only storage and fail-closed behavior.
The isolated HTTP suite also verifies no Shopify calls on either store failure
or a missing shared secret, with 503, Retry-After and no-store.

Use the configured **development** database with the current Drizzle schema
(`pnpm --filter @workspace/db run push`) and a configured `SESSION_SECRET`.
The suite deliberately fails if either dependency is absent. Only randomized
`security-test:` namespaces with fictional inputs are written, and cleanup
deletes only that run's counters. No Shopify/Clerk networking occurs. Actual
commerce data is never created or read. Do not point this test at production.

Merchant first-purchase setup remains outside these suites.
