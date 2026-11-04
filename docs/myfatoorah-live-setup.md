# Amore Cookies: direct MyFatoorah payments

## Current state and ownership

New orders are stored in the application's existing PostgreSQL database.
Shopify remains the product and inventory source; existing Shopify orders are
preserved and remain available separately in the administration page.

This integration uses the **official live Kuwait API, v3**, with hosted payment.
There is no sandbox switch, public test token, card form, or demo-success fallback.
Automated tests use isolated HTTP mocks, never real gateway transactions.

**Live checkout is disabled by default.** Installing this code is NOT approval
to charge a customer, subscribe to a plan, or accept a provider's fees.

## Owner actions before activation

1. Obtain MyFatoorah's written Kuwait quote. Confirm setup, monthly, API,
   KNET/card/Apple Pay, settlement, refund and chargeback charges. The owner must
   approve the quote; no zero-fee claim is made.
2. Have MyFatoorah approve the merchant account and activate Kuwait API access,
   KNET, Visa/Mastercard, and Apple Pay where eligible. Enable Create Payment,
   Get Payment Details, Get Invoice, and Get Payment Methods permissions.
3. The authorized account owner adds these **only through Replit Secrets**:
   - `MYFATOORAH_API_KEY`: the approved **production Kuwait** key.
   - `MYFATOORAH_WEBHOOK_SECRET`: the secure key configured for Webhook V2.
   Existing `SESSION_SECRET` must also be present and stable.
   Never put values in chat, source code, browser variables or screenshots.
4. Obtain the actual published origin from the deployment settings, not from a
   development preview URL. Configure non-secret `PAYMENT_PUBLIC_ORIGIN` with
   that HTTPS origin, without paths, credentials, query strings or fragments.
   Preview `.replit.dev` domains are explicitly rejected.
5. Approve the delivery policy. This implementation supports an owner-approved
   flat Kuwait delivery charge. Set `MYFATOORAH_SHIPPING_FILS` to its integer
   fils value (1000 fils = 1 KWD). Set `0` only if free delivery is actually
   approved. No delivery charge is silently assumed.
6. Configure **Webhook V2, PAYMENT_STATUS_CHANGED** in the provider portal at:
   `<published-origin>/api/payments/webhook`, with secure signing enabled.
   Unsupported refund/dispute events must not be subscribed to this endpoint.
7. Only after the owner approves the corresponding conditions, configure:
   - `MYFATOORAH_ACCOUNT_APPROVED=true`
   - `MYFATOORAH_FEES_APPROVED=true`
   - `MYFATOORAH_DELIVERY_APPROVED=true`
   - `MYFATOORAH_LIVE_ENABLED=true`
8. A production deployment (`NODE_ENV=production`) is required. Enable checkout
   in the existing administrator settings only after all preceding checks pass.
   Development workflows cannot charge real payments even if a key is present.

This code change does not publish the project or set any of these approvals.
No real small-value verification purchase may be made without separate approval.

## Checkout and verification

- The server reads the signed cart cookie and fresh catalog prices/quantities.
  Duplicate variant rows are aggregated before validating stock.
- All amounts are calculated in integer KWD fils, including approved delivery.
  The browser cannot supply a trusted price, total, payment status or currency.
- Direct checkout currently rejects Shopify discount codes; it never silently
  charges an undiscounted total after showing a discount. Clear existing codes
  before checkout. No automatic currency conversion is performed.
- A local order is persisted before reserving Shopify inventory. Reservations
  use compare-and-set quantities and a durable Shopify idempotency key.
- A single pending payment attempt is allowed per signed cart. Double-clicks
  reuse the existing payable invoice; uncertain invoice creation is never
  automatically retried as a new charge.
- `POST /v3/payments` specifies KWD, a unique external order reference,
  hosted-payment redirection, webhook, and a 30-minute expiry.
- Webhook V2 signatures use the official ordered field string and HMAC-SHA256,
  compared in constant time. Both webhook and callback additionally perform
  authenticated `GET /v3/payments/{paymentId}`.
- Paid requires `Invoice.Status=PAID` **and** `Transaction.Status=SUCCESS`,
  matching invoice, external order ID, payment ID, full amount and KWD currency.
  Authorization, pending, a success URL, or an unsigned webhook is not payment.
- Once paid, a late failure/cancellation cannot downgrade the order. Shipping
  stages can only advance on confirmed paid orders with confirmed inventory.
- Receipt pages use an unguessable per-order access token and return no phone,
  address, card token or provider response. Administrative details require the
  existing verified-owner authorization.

## Recovery and stock

The server reconciles a bounded batch of held attempts every minute. It checks
invoice transactions independently of whether the buyer returns to the site.
Provider credentials are required for reconciliation, but the live-enable flag
may remain off so previously initiated payments can still be verified.

Stock is **not** released on a browser cancellation, failed attempt, elapsed
local timer, or provider outage. The provider invoice must be independently
confirmed expired and unpaid, with no authorized/in-progress transactions and
a grace period. Release uses a separate durable idempotent compare-and-set.

If MyFatoorah cannot find an invoice without transactions, the stock remains
held and the administrator must review the provider portal. This is intentional:
an uncertain invoice may still be payable. The UI shows inventory/payment
states and a reconciliation button; never manually mark an order paid.
Do not increment Shopify availability manually to bypass a held attempt.

Refunds and disputes must be handled in the merchant portal; automated
refund/dispute reconciliation is not part of the initial payment flow.
When rotating `SESSION_SECRET`, existing receipt links become invalid; phone
and order-number tracking remains available.

## Official references

- https://docs.myfatoorah.com/docs/v3-hosted-payment-page
- https://docs.myfatoorah.com/reference/create-payment
- https://docs.myfatoorah.com/reference/get-payment-methods
- https://docs.myfatoorah.com/docs/get-payment-details
- https://docs.myfatoorah.com/docs/webhook-v2-payment-status-data-model
- https://docs.myfatoorah.com/docs/webhook-signature
- https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines
- https://docs.myfatoorah.com/reference/get-invoice-by-invoiceid
