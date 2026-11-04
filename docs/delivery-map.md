# Delivery-location map

New direct checkout addresses include a confirmed `location` object with
numeric `latitude` and `longitude`. The server validates finite ranges and
includes the point in the payment attempt's request fingerprint. Addresses
remain stored in the existing order JSON column; this change needs no new
table or destructive database migration. Historical orders may omit location.

The frontend starts on Kuwait without an assumed marker. Map click, marker
drag, native geolocation, and manual coordinates produce an unconfirmed
candidate; the customer must explicitly confirm it. Editing a coordinate or
moving the marker invalidates confirmation. Geolocation is requested only by
the customer's button click; manual selection remains available after denial,
timeout or iframe restrictions. No geocoding is performed. Coordinates do not
establish delivery eligibility, change shipping charges, or enable payments.

Coordinates are available to authorized local-order administration only.
Public payment receipts/tracking do not include addresses or coordinates.
Do not add precise location to logs or future assistant prompts.

## Tile service and privacy

Leaflet uses standard HTTPS OpenStreetMap raster tiles, directly in the
browser, with visible copyright attribution and origin-only cross-site
Referer. Browser caching is left enabled. There is no Google Maps key,
subscription, paid fallback, tile proxy, offline download or prefetch job.
The configurable tile URL/allowed hosts/attribution are in
`delivery-location-picker.tsx`; any future provider must be reviewed for
pricing, licensing, attribution, privacy and permitted use before switching.
Invalid provider configuration fails visibly rather than silently switching.

OSM receives normal map tile requests, the viewed area and browser/network
information—not the order's address, phone, receipt token or exact marker as
a query parameter. The viewed tiles can reveal an approximate area, so the
picker includes a privacy notice. Tiles are donation-supported, best-effort,
without guaranteed capacity or availability. They are not an unlimited map
hosting service.

Policy: https://operations.osmfoundation.org/policies/tiles/

## Checks

- `pnpm --filter @workspace/amore-cookies run test:location`
- `pnpm --filter @workspace/api-server run test:payments`
- `pnpm run typecheck`

Payment tests use isolated provider/inventory mocks and self-cleaning development
database fixtures. They prove location persistence, administrative serialization,
public redaction, historical compatibility and idempotency behavior without
a real payment or inventory reservation.

Publication and published-site verification remain part of the dependent
release task; these development checks are not proof of production deployment.
