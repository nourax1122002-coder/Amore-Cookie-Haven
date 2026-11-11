# Stripe Checkout in test mode only

This project uses Supabase Edge Functions for Stripe Test Mode session creation and webhook verification. The Express API keeps Supabase's server key on the backend; the browser only receives a Stripe-hosted test Checkout URL. Stripe collects in **USD** because this Stripe account does not support KWD. Catalog prices and each order's original `total_fils`/`currency = KWD` remain unchanged. The server converts the stored KWD total using the free, keyless ExchangeRate-API KWD base rate, records the USD minor-unit amount and rate with the order, and fails closed when the rate is unavailable or more than 48 hours old. ExchangeRate-API updates daily and requires attribution; Stripe Checkout displays the original KWD amount and rate in the first line item's description. Existing legacy payment fields and order records are retained, but the old MyFatoorah payment flow is no longer active.

## Before enabling the test flow

1. Apply the already-installed `0006_stripe_test_checkout` schema and the additive `lib/db/migrations/0007_stripe_usd_settlement.sql` migration to the intended Supabase database. The new migration only adds nullable/defaulted payment columns and updates the existing account-order sync trigger; it does not delete, recreate, or rewrite existing customer order records.
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

The checkout function rejects keys that are not `sk_test_` and rejects any Stripe event with `livemode: true`. Stripe-hosted Checkout does not need a browser publishable key. The function verifies the original KWD totals against the order's server-saved item and delivery amounts, converts those exact totals into USD cents with a largest-remainder allocation so the Checkout line items sum exactly to the charged amount, and saves both currencies and the conversion-rate metadata on the order. Only a signed Test Mode webhook can mark an order paid or record a refund. No live payment key or payment mode is accepted.

## Local verification

```sh
deno test --config supabase/functions/deno.json supabase/functions/_shared/stripe-domain.test.ts
deno test --config supabase/functions/deno.json supabase/functions/_shared/kwd-usd-settlement.test.ts
deno check --config supabase/functions/deno.json supabase/functions/stripe-checkout/index.ts supabase/functions/stripe-webhook/index.ts
```

End-to-end Checkout requires the user's Stripe test keys, deployed Edge Functions, and a test-mode webhook endpoint; unit tests do not substitute for that hosted verification.
