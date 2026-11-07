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
