---
name: Free services and verified release
description: Cost and privacy constraints for delivery maps, Arabic AI and publishing.
---

For Amore Cookies, prioritize tools with no API key and no subscription.
Use Leaflet/OpenStreetMap-based maps and browser geolocation; no paid Google
Maps API or restricted/unsupported geocoding service. Use a free OpenRouter
model with OPENROUTER_API_KEY stored only in Secrets. Do not activate paid
services or incur charges.

**Why:** The user explicitly required these constraints for the bonus features.

**How to apply:** Explain provider limits before implementation, fail honestly
when free quotas or availability are exhausted, and never silently fall back
to paid AI routes. Preserve the existing branding. Do not claim the bonus
features complete until they have also been tested in the published version.

A zero-priced model catalogue entry is not proof that a usable free route
exists under the required privacy and capability constraints.

**Why:** Live free-provider requests can be throttled or unavailable even when
the account check and zero-price catalogue discovery succeed.

**How to apply:** Require an actual Arabic model reply and zero-cost metadata
where available before declaring the assistant ready. Treat failed live
verification as a blocker, not permission to loosen privacy or pay for access.
