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
