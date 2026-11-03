---
name: Shopify order access checks
description: Live connection permissions can differ from connector documentation; protected phone access is a separate approval.
---
Check the live Shopify installation's granted scopes before concluding that order reads are unavailable. Catalog-focused connector documentation has understated the actual grants in this project.

**Why:** The installed connection exposed order-reading scopes and accepted order queries even though the prior project instructions and connector overview said tracking was unavailable. An empty order query does not prove that protected phone fields will be available for an actual customer.

**How to apply:** Inspect scopes through the existing authenticated proxy without extracting credentials; use minimum-data read-only probes. Treat protected-field errors as unavailable, not as a nonexistent order. Never assume order-write permission from read permission.
