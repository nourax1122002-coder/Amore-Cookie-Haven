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
rate limiters, schemas, error handler and production request logging. Requests use a fresh loopback-only server on an
ephemeral port, not the running storefront. Each run starts a fresh process so
limiter state cannot persist between runs; the two limiter tests independently
exercise the IP and normalized-order limits without sleeping or disabling them.

Only external identity/database boundaries are replaced at bundle time. A
fictional identity adapter returns anonymous, verified visitor, unverified
owner and verified owner states, while the real `requireAdmin` policy still
runs. A small in-memory repository fake provides security counters and fault
injection. These tests do not contact Supabase Auth or use real accounts.

The runner whitelists child-process environment variables instead of inheriting
credentials. Any unexpected outbound request fails the suite. No live database,
payment provider or privileged account is used.

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
tracking fails closed on a missing shared hashing secret, with 503,
Retry-After and no-store.

Merchant first-purchase setup remains outside these suites.
