---
name: Flavor Rewards scope
description: The product boundary for the Amore Flavor Rewards feature.
---

Flavor Rewards belongs inside the existing Amore Cookies website. Do not create a separate site, app, URL, or deployment for it.

**Why:** The user explicitly redirected the original standalone proposal and approved the existing-store integration.

**How to apply:** Add future Flavor Rewards screens and admin workflows to the current Amore artifact, reuse its Supabase Auth and database, and ask before proposing any separate artifact or deployment.

Reward eligibility is based only on verified successful eligible paid flavor orders: one lifetime flavor idea per account, a one-time 200 KWD milestone at 100 such orders, and 15% commission beginning with order 101. Interest registrations, manual sales, failed/cancelled payments, refunds, and chargebacks must not create or retain invalid earnings; event handling must be idempotent and corrections append-only.

**Why:** The user approved these rules in the Flavor Rewards audit and explicitly required local code/testing only until separate approval for database work.

**How to apply:** Do not treat interest counts or admin-entered sales as payment evidence. Tie future persistent rewards to the existing verified Stripe Test Mode payment flow, add refund/dispute corrections without deleting ledger history, and obtain approval before any Supabase schema, policy, or data change.
