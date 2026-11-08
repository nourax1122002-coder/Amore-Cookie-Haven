---
name: Amore Supabase access
description: The durable Supabase runtime and security boundary selected for Amore Cookies.
---

For Amore runtime database access, use server-side `@supabase/supabase-js` with `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` stored in Replit Secrets. Apply schema changes through Supabase MCP migrations. Do not use a raw database URL or browser key for privileged writes. Keep private tables protected by RLS with no public policies; only the backend uses the secret key.

The owner has since confirmed that Supabase should replace Clerk and Shopify for store accounts, administrator access, product catalog, prices, images, inventory, and order records. Preserve both administrator authorization and guest checkout.

Keep Auth operations on isolated Supabase clients rather than the shared privileged database client. A shared client can retain or apply a user session across concurrent server requests, which risks mixing user-authenticated and service-role access.

Expose account order history through a read-only RLS-protected projection of the private checkout records. The checkout service and payment reconciliation remain the only writers of order totals and status; customers must not be able to edit or delete those records through the browser. Favorites are customer-owned and support full CRUD under `auth.uid()` RLS.

**Why:** The owner asked to connect through Supabase MCP and the framework rather than a raw server link, then explicitly chose Supabase as the sole store backend and asked to remove Clerk. Letting customers edit order totals, payment state, or fulfillment history would undermine payment integrity and the store's audit trail.

**How to apply:** Follow this boundary for order, inquiry, settings, quota, product, inventory, cart, and account persistence. Verify schema/RLS through MCP and exercise RPCs without exposing customer data or credentials.

Hosted Supabase email/password sign-up can create an unconfirmed Auth user while returning no session. The built-in email service has provider-side sending limits; an `over_email_send_rate_limit` 429 is not an incorrect project URL/key or the app's own IP limiter. Never disable confirmation to conceal this failure; preserve the user and explain that retrying after quota reset or configuring SMTP is required.

**Why:** Amore's Auth audit logs showed a saved but unconfirmed user, an email confirmation send blocked by Supabase's hourly sending quota, and an unusable/expired one-time link.

**How to apply:** When diagnosing Supabase sign-up, check Auth logs and `auth.users` confirmation status, distinguish provider 429s from app rate limits, and do not claim end-to-end sign-in works until confirmation email delivery and a real user sign-in are verified.

For Amore account authentication, use Supabase only and keep it entirely free: no Brevo, Clerk, paid email service, subscription, or custom domain. Keep email confirmation enabled and never bypass Supabase's built-in email restrictions or rate limits.

**Why:** The user explicitly set these provider and cost constraints for this store.

**How to apply:** Explain when Supabase's default mail service prevents customer email delivery; do not add another SMTP provider or disable confirmation unless the user changes this scope.
