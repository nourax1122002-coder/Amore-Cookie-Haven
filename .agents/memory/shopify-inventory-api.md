---
name: Shopify inventory API compatibility
description: Non-obvious differences in the connector's Shopify inventory mutation schema.
---

Inventory writes through this connector require field-level `@idempotent(key: ...)`. Its live schema uses `changeFromQuantity` on each inventory quantity rather than the older `ignoreCompareQuantity` input option.

**Why:** Canonical-looking mutations failed against the actual connector; introspection confirmed the changed directive and input requirements. Do not assume examples from older Shopify versions are compatible.

**How to apply:** Before extending inventory writes, inspect the live GraphQL input and directive definitions through the approved Admin proxy. Use a unique idempotency key per intended mutation and compare against the current available quantity to avoid overwriting concurrent changes.
