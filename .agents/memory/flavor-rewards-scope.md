---
name: Flavor Rewards scope
description: The product boundary for the Amore Flavor Rewards feature.
---

Flavor Rewards belongs inside the existing Amore Cookies website. Do not create a separate site, app, URL, or deployment for it.

**Why:** The user explicitly redirected the original standalone proposal and approved the existing-store integration.

**How to apply:** Add future Flavor Rewards screens and admin workflows to the current Amore artifact, reuse its Supabase Auth and database, and ask before proposing any separate artifact or deployment.

Reward eligibility is based only on verified successful eligible paid flavor orders: one lifetime flavor idea per account, a one-time 200 KWD milestone when the flavor reaches 100 such orders, and 15% commission beginning with order 101. The milestone is permanent once earned and can never be reversed or awarded twice. Refunds and chargebacks may adjust only the commission for the affected order; they never reduce the milestone. Interest registrations and manual sales are not payment evidence. Event handling must be idempotent and financial corrections append-only.

**Why:** The user approved these rules in the Flavor Rewards audit and explicitly required local code/testing only until separate approval for database work.

**How to apply:** Do not treat interest counts or admin-entered sales as payment evidence. Tie future persistent rewards to the existing verified Stripe Test Mode payment flow. Store the one-time milestone as a non-reversible, unique award; scope signed refund/dispute corrections to commissions only, without deleting ledger history. Obtain approval before any Supabase schema, policy, or data change.

Approved Flavor Rewards creations reuse existing catalog products and inventory, but their purchases use separate flavor-only orders so payment corrections can be attributed to one flavor. Buyers may make repeat purchases; the one-per-lifetime rule applies to the creator's idea, not to buyers.

**Why:** The user selected the existing-products/separate-orders model to preserve catalog and stock data while making refunds attributable.

**How to apply:** Link each approved published flavor to one existing KWD catalog product. Keep ordinary carts unchanged and ensure a mapped flavor is purchased through a dedicated order; count each distinct verified paid order, including repeat purchases by the same buyer.
