---
name: Shopify market and cart quantities
description: Direct Kuwait payments must not force an unconfigured Kuwait Shopify Market.
---

The merchant's Shopify catalog can report stock while a cart forced to the
Kuwait Shopify Market returns quantity zero, no userErrors, and an
`MERCHANDISE_OUT_OF_STOCK` warning. The same product in the default catalog
market accepts the requested quantity.

**Why:** A real browser check reproduced this with eleven available bags and
an attempted addition of two. Inventory alone did not explain the failure;
the buyerIdentity country changed availability.

**How to apply:** With direct MyFatoorah/local Kuwait delivery, keep cart
selection in the Shopify default catalog market. Do not mistake that market
for the buyer's delivery address, or restore `countryCode: KW` without
verifying the merchant's Market setup. Treat returned quantity mismatches as
errors; do not infer missing quantities or reset stock.
