# Administrative write HTTP security regressions

Run `pnpm --filter @workspace/api-server run test:admin:http` from the repository
root, or `pnpm run validate` for typechecks and all server suites.

The suite bundles the real Express app, `sameOrigin`, `requireAdmin`, admin routes,
Zod schemas, settings persistence code and product/catalog code. It uses an
ephemeral loopback server, never the running store. It covers:

- `POST /api/admin/products`, both creation and editing with an existing ID.
- `PUT /api/admin/settings`.
- `PATCH /api/admin/inquiries/:id`.

Every write is checked for anonymous (401), verified non-owner (403), and
unverified owner (403) rejection. Even a verified owner is rejected for an
external, malformed, opaque or deceptive Origin (403), non-JSON or missing
Content-Type (415), and malformed JSON (400). Rejections assert zero database
access and zero external service requests, plus unchanged in-memory state.
An empty owner allowlist also fails closed.

Positive controls require successful writes and matching fake state/responses,
so blanket rejections cannot make the suite pass. Matching Origin, omitted
Origin for non-browser clients, and the first forwarded host behind a proxy
are exercised. Product, settings and inquiry writes use a small in-memory
Supabase repository fake. The fake reuses schema definitions only, never the
real database entrypoint.

`test/run-orders-http.mjs` is shared with the order HTTP suite and selects this
suite with the `admin-http` argument. Each suite gets a fresh process and its
own database mock. The child environment is allowlisted: real credentials,
database URLs and account identities are not inherited. The fictional auth
adapter does not test real token validation or login. All outbound requests are
blocked. No real accounts, settings, products, inquiries or orders are accessed
or changed by this suite.
