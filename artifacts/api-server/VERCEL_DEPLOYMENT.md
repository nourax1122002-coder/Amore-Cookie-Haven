# Amore Cookies API on Vercel

## Project settings

Link the full repository so the API can resolve the workspace packages in
`lib/db` and `lib/api-zod`, then set:

- Root Directory: `artifacts/api-server`
- Enable “Include source files outside of the Root Directory in the Build Step”
- Framework Preset: `Express`
- Build Command: leave to the Express preset; do not override
- Output Directory: leave blank / automatic; do not set `dist`
- Install Command: automatic (pnpm workspace lockfile)

Do not enter the text `N/A` as an Output Directory. If the Vercel build log says
it is searching in `"N/A"`, disable the Output Directory override or clear that
field; Vercel is treating the text as a literal folder name.

Vercel runs the package's `vercel-build` script, which performs the API
TypeScript checks and then creates the esbuild bundle. It detects the Express
app through the root `index.mjs`, which exports that bundle from `dist/`.
This avoids a second TypeScript emit by Vercel after the checked bundle has
already been produced. Replit continues to start `src/index.ts` as before.
Do not point Vercel at a standalone copy of `artifacts/api-server`; it depends
on workspace packages outside that directory.

## Environment variables

Set these in Vercel's server-side Environment Variables for Production and
Preview:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SESSION_SECRET`
- `ADMIN_EMAILS`
- `CRON_SECRET`
- `GROQ_API_KEY` (for the current AI provider)
- `OPENROUTER_API_KEY` (optional fallback)

Keep secret values locked. Do not add payment credentials or enable live
payments as part of this migration. Vercel provides its own runtime port; do
not set `PORT` for the Vercel deployment.

## Runtime differences

The Replit service continues to use `src/index.ts` as a persistent listener and
keeps its existing minute-level counter cleanup and payment reconciler. On
Vercel, the same default-exported Express app runs request-by-request and does
not start those process timers. `vercel.json` invokes the protected
`GET /api/maintenance` route once per day. Set `CRON_SECRET`; the route prunes
expired Supabase counters and, only when a MyFatoorah key is configured, runs a
bounded payment-reconciliation batch.

Vercel Hobby allows a cron schedule only once per day (with up to 59 minutes of
timing variance). Payment callbacks and authenticated webhooks still verify
payments immediately, but abandoned-payment inventory cleanup can be delayed
until the daily run. Do not enable live checkout on Hobby if minute-level
reconciliation is required; use an approved worker/schedule that supports the
required frequency first.

Vercel Functions also cap request bodies at 4.5 MB. The admin image uploader
therefore requests an admin-authorized, one-time Supabase Storage upload URL
and sends the image directly to Storage. The existing 5 MB image limit is
preserved without passing image bytes through the Function.

## Pre-deployment checks

Run the workspace `pnpm run validate`, then build the API with
`pnpm --filter @workspace/api-server run build`. Verify `/api/healthz`, the
storefront, auth, account, assistant, currency, cart, checkout, admin image
signing, and payment routes in a Vercel Preview deployment. The current
Replit workflows remain unchanged; no production deployment is performed by
these code changes.
