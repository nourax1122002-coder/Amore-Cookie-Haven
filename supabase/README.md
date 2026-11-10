# Stripe Checkout in test mode only

This project uses Supabase Edge Functions for Stripe session creation and webhook verification. The Express API keeps Supabase's server key on the backend; the browser only receives a Stripe-hosted test Checkout URL. MyFatoorah remains unchanged.

## Before enabling the test flow

1. Apply `lib/db/migrations/0006_stripe_test_checkout.sql` to the intended Supabase database. It only adds payment columns and updates the existing account-order sync trigger; it does not delete or recreate tables.
2. Deploy both Edge Functions from the repository root:

   ```sh
   supabase functions deploy stripe-checkout
   supabase functions deploy stripe-webhook
   ```

   `supabase/config.toml` disables platform JWT verification only for these two functions. `stripe-checkout` then requires the Supabase server key in the `apikey` header; `stripe-webhook` requires Stripe's signed raw request body.
3. In **Supabase Dashboard → Project → Edge Functions → Secrets**, set:
   - `STRIPE_SECRET_KEY` — Stripe **test** secret key, beginning `sk_test_`.
   - `STRIPE_WEBHOOK_SECRET` — signing secret for the Stripe **test-mode** webhook endpoint, beginning `whsec_`.
4. In Stripe's dashboard, while **Test mode** is selected, add a webhook endpoint pointing to the Supabase `stripe-webhook` function URL. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, and `charge.refunded`. Copy that endpoint's test signing secret into `STRIPE_WEBHOOK_SECRET`.
5. The API uses the existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` values in Replit/Vercel. The server sends the Supabase key only in the `apikey` header to the protected checkout function; it is never returned to the browser. No existing environment variables need to be changed.

The checkout function rejects keys that are not `sk_test_` and rejects any Stripe event with `livemode: true`. Stripe-hosted Checkout does not need a browser publishable key. The function verifies KWD totals against the order's server-saved item and delivery amounts, confirms the Stripe session against the order before recording payment, and records refunds only from signed test webhook events. No function, migration, secret, or production deployment is applied automatically by this change.

## Local verification

```sh
deno test --config supabase/functions/deno.json supabase/functions/_shared/stripe-domain.test.ts
deno check --config supabase/functions/deno.json supabase/functions/stripe-checkout/index.ts supabase/functions/stripe-webhook/index.ts
```

End-to-end Checkout requires the user's Stripe test keys, deployed Edge Functions, and a test-mode webhook endpoint; unit tests do not substitute for that hosted verification.
